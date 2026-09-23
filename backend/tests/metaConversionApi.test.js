const request = require('supertest');
const { createTestApp } = require('./setup');
const { runIntegration } = require('../src/models/integrations');
const { enqueueAndAttempt } = require('../src/models/deliveryQueue');

const FBC = 'fb.1.1758600000000.IwAR2abc_DEF-123';
const FBP = 'fb.1.1758600000000.1234567890';

const steps = [
  { id: 'f_email', type: 'email', label: 'Email' },
  { id: 'f_name', type: 'text', label: 'Name' },
];

const integration = {
  id: 'int-meta',
  type: 'meta_conversion_api',
  enabled: 1,
  config: JSON.stringify({ pixel_id: '123', access_token: 'tok' }),
};

function mockFetch() {
  const calls = [];
  global.fetch = jest.fn(async (url, opts) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : undefined });
    return { ok: true, status: 200, text: async () => '' };
  });
  return calls;
}

describe('Meta Conversions API', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  describe('event payload', () => {
    it('sends the submission id as event_id and fbc/fbp unhashed in user_data', async () => {
      const calls = mockFetch();
      await runIntegration(integration, 'form-1', 'Form', { f_email: 'A@b.de ' }, steps, {
        submissionId: 'sub-1', ip: '1.2.3.4', userAgent: 'UA', fbc: FBC, fbp: FBP,
      });
      const event = calls[0].body.data[0];
      expect(event.event_id).toBe('sub-1');
      expect(event.user_data.fbc).toBe(FBC);
      expect(event.user_data.fbp).toBe(FBP);
      expect(event.user_data.em).toHaveLength(1);
    });

    it('omits fbc/fbp when none were captured', async () => {
      const calls = mockFetch();
      await runIntegration(integration, 'form-1', 'Form', {}, steps, { submissionId: 'sub-2' });
      const { user_data } = calls[0].body.data[0];
      expect(user_data).not.toHaveProperty('fbc');
      expect(user_data).not.toHaveProperty('fbp');
    });
  });

  describe('delivery queue', () => {
    it('passes the submission id through as event_id', async () => {
      const calls = mockFetch();
      // Just enough of better-sqlite3 for one delivery: list the integration,
      // accept the delivery-row writes.
      const fakeDb = {
        prepare: (sql) => (sql.includes('FROM integrations')
          ? { all: () => [integration] }
          : { run: () => {}, get: () => ({ attempts: 0 }) }),
      };
      await enqueueAndAttempt(fakeDb, 'form-1', 'Form', 'sub-queue', {}, steps, { ip: '1.2.3.4' });
      expect(calls[0].body.data[0].event_id).toBe('sub-queue');
    });
  });

  describe('public submit', () => {
    let app;
    beforeAll(() => { app = createTestApp(); });

    beforeEach(() => {
      mockFetch();
      const db = require('../src/models/db').getDb();
      db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run('meta-user', 'meta@test.com', 'x', 'user');
      db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
        .run('meta-form', 'meta-user', 'Meta Form', 'meta-form', JSON.stringify(steps));
    });

    function storedMetadata(id) {
      const db = require('../src/models/db').getDb();
      return JSON.parse(db.prepare('SELECT metadata FROM submissions WHERE id = ?').get(id).metadata);
    }

    it('stores well-formed fbc/fbp from the tracking payload', async () => {
      const res = await request(app)
        .post('/api/public/form/meta-form/submit')
        .send({ data: { f_email: 'a@b.de' }, tracking: { fbc: FBC, fbp: FBP, gclid: 'g1' } });
      expect(res.status).toBe(201);
      const metadata = storedMetadata(res.body.id);
      expect(metadata.fbc).toBe(FBC);
      expect(metadata.fbp).toBe(FBP);
      expect(metadata.gclid).toBe('g1');
      expect(metadata).not.toHaveProperty('submissionId');
    });

    it('drops malformed fbc/fbp values', async () => {
      const res = await request(app)
        .post('/api/public/form/meta-form/submit')
        .send({ data: { f_email: 'a@b.de' }, tracking: { fbc: 'IwAR-raw-fbclid', fbp: 'fb.1.123.<script>' } });
      expect(res.status).toBe(201);
      const metadata = storedMetadata(res.body.id);
      expect(metadata).not.toHaveProperty('fbc');
      expect(metadata).not.toHaveProperty('fbp');
    });
  });
});
