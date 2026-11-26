const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { google } = require('googleapis');
const { createTestApp } = require('./setup');
const { sanitizeTracking, trackingFromMetadata, TRACKING_EXPORT_KEYS } = require('../src/utils/tracking');
const { encrypt } = require('../src/models/encryption');
const { enqueueAndAttempt, processDueStatusChecks, processDueDeliveries } = require('../src/models/deliveryQueue');
const { runIntegration } = require('../src/models/integrations');

function getDb() {
  return require('../src/models/db').getDb();
}

const steps = [
  { id: 'f_name', key: 'name', type: 'text', label: 'Name', required: true },
  { id: 'f_email', key: 'email', type: 'email', label: 'Email' },
];

function seed() {
  const db = getDb();
  const userId = uuid();
  const formId = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, 'owner@test.com', bcrypt.hashSync('ownerpass', 10), 'user');
  db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
    .run(formId, userId, 'Tracking Form', 'ics01', JSON.stringify(steps));
  return { userId, formId };
}

function addIntegration(formId, type, config) {
  const id = uuid();
  getDb().prepare('INSERT INTO integrations (id, form_id, type, enabled, config) VALUES (?, ?, ?, 1, ?)')
    .run(id, formId, type, encrypt(JSON.stringify(config)));
  return id;
}

async function login(app) {
  const res = await request(app).post('/api/auth/login').send({ email: 'owner@test.com', password: 'ownerpass' });
  return res.headers['set-cookie'];
}

function storedMetadata(id) {
  return JSON.parse(getDb().prepare('SELECT metadata FROM submissions WHERE id = ?').get(id).metadata);
}

// The submit route answers before it delivers; wait for the delivery rows to
// leave 'pending'.
async function settled(submissionId) {
  for (let i = 0; i < 100; i++) {
    const rows = getDb().prepare('SELECT status FROM integration_deliveries WHERE submission_id = ?').all(submissionId);
    if (rows.length && rows.every(r => r.status !== 'pending')) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('deliveries did not settle');
}

const GOOGLE_ADS_CONFIG = {
  client_id: 'cid', client_secret: 'secret', refresh_token: 'rt',
  customer_id: '123-456-7890', conversion_action_id: '42',
};

// Data Manager API fake: ingest accepts with a request id, the status lookup
// reports the gclid as undecodable (what Google answers for e.g. "TEST123").
function mockGoogle({ requestStatus = 'FAILED', reason = 'PROCESSING_ERROR_REASON_INVALID_GCLID' } = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    if (String(url).includes('events:ingest')) {
      return { ok: true, status: 200, json: async () => ({ requestId: 'req-123' }), text: async () => '' };
    }
    if (String(url).includes('requestStatus:retrieve')) {
      const perDestination = { requestStatus, eventsIngestionStatus: { recordCount: '1' } };
      if (requestStatus !== 'SUCCESS' && requestStatus !== 'PROCESSING') {
        perDestination.errorInfo = { errorCounts: [{ recordCount: '1', reason }] };
      }
      return { ok: true, status: 200, json: async () => ({ requestStatusPerDestination: [perDestination] }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  });
  return calls;
}

describe('UTM / click-ID tracking', () => {
  const realFetch = global.fetch;
  let tokenSpy;
  let app;
  beforeAll(() => { app = createTestApp(); });
  beforeEach(() => {
    tokenSpy = jest.spyOn(google.auth.OAuth2.prototype, 'getAccessToken').mockResolvedValue({ token: 'access-token' });
  });
  afterEach(() => {
    global.fetch = realFetch;
    tokenSpy.mockRestore();
  });

  describe('sanitizeTracking (UTM parsing on the server)', () => {
    it('keeps the five UTM parameters and the Google click ids', () => {
      expect(sanitizeTracking({
        utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test', utm_term: 'shoes', utm_content: 'ad-1',
        gclid: 'TEST123', gbraid: 'gb', wbraid: 'wb',
      })).toEqual({
        utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test', utm_term: 'shoes', utm_content: 'ad-1',
        gclid: 'TEST123', gbraid: 'gb', wbraid: 'wb',
      });
    });

    it('drops unknown keys, non-strings and empty values', () => {
      expect(sanitizeTracking({ utm_source: '', utm_medium: 42, email: 'a@b.de', ip: '1.2.3.4', utm_id: 'x' })).toEqual({});
      expect(sanitizeTracking(null)).toEqual({});
      expect(sanitizeTracking(['utm_source'])).toEqual({});
      expect(sanitizeTracking('utm_source=google')).toEqual({});
    });

    it('trims, strips control characters and caps the length', () => {
      const out = sanitizeTracking({ utm_source: '  news\u0000let\nter ', utm_campaign: 'x'.repeat(500) });
      expect(out.utm_source).toBe('newsletter');
      expect(out.utm_campaign).toHaveLength(200);
    });

    it('maps metadata to one value per export key', () => {
      const t = trackingFromMetadata({ utm_source: 'google', gclid: 'g', ip: '1.2.3.4', fbp: 'fb.1.1700000000000.1' });
      expect(Object.keys(t)).toEqual(TRACKING_EXPORT_KEYS);
      expect(t.utm_source).toBe('google');
      expect(t.gclid).toBe('g');
      expect(t.utm_medium).toBeNull();
      expect(t).not.toHaveProperty('ip');
      expect(t).not.toHaveProperty('fbp');
    });
  });

  describe('persistence', () => {
    it('stores UTMs and click ids with the submission, nothing else from `tracking`', async () => {
      seed();
      const res = await request(app).post('/api/public/form/ics01/submit').send({
        data: { f_name: 'Ada' },
        tracking: { gclid: 'TEST123', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test', foo: 'bar', ip: '6.6.6.6' },
      });
      expect(res.status).toBe(201);
      const metadata = storedMetadata(res.body.id);
      expect(metadata).toMatchObject({ gclid: 'TEST123', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test' });
      expect(metadata).not.toHaveProperty('foo');
      expect(metadata.ip).not.toBe('6.6.6.6');
    });

    it('returns the tracking keys in the submissions list (metadata)', async () => {
      seed();
      const sub = await request(app).post('/api/public/form/ics01/submit')
        .send({ data: { f_name: 'Ada' }, tracking: { utm_source: 'google' } });
      const cookie = await login(app);
      const { formId } = { formId: getDb().prepare("SELECT id FROM forms WHERE slug = 'ics01'").get().id };
      const list = await request(app).get(`/api/submissions/${formId}`).set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body.submissions[0].id).toBe(sub.body.id);
      expect(list.body.submissions[0].metadata.utm_source).toBe('google');
    });
  });

  describe('filters', () => {
    it('filters the list by UTM values and Google Ads click, and lists the distinct values', async () => {
      const { formId } = seed();
      const post = (tracking) => request(app).post('/api/public/form/ics01/submit').send({ data: { f_name: 'A' }, tracking });
      await post({ utm_source: 'google', utm_medium: 'cpc', gclid: 'g1' });
      await post({ utm_source: 'google', utm_medium: 'cpc', gbraid: 'b1' });
      await post({ utm_source: 'newsletter', utm_medium: 'email' });
      await post({});
      const cookie = await login(app);
      const get = (q) => request(app).get(`/api/submissions/${formId}?${q}`).set('Cookie', cookie);

      expect((await get('')).body.total).toBe(4);
      expect((await get('utm_source=google')).body.total).toBe(2);
      expect((await get('utm_source=google&utm_medium=email')).body.total).toBe(0);
      expect((await get('utm_source=__none__')).body.total).toBe(1);
      expect((await get('google_ads_click=yes')).body.total).toBe(2);
      expect((await get('google_ads_click=no')).body.total).toBe(2);
      expect((await get('google_ads_click=maybe')).body.total).toBe(4);

      const filters = await request(app).get(`/api/submissions/${formId}/filters`).set('Cookie', cookie);
      expect(filters.body.values).toEqual({ utm_source: ['google', 'newsletter'], utm_medium: ['cpc', 'email'], utm_campaign: [] });

      const csv = await request(app).get(`/api/submissions/${formId}/export?utm_source=newsletter`).set('Cookie', cookie);
      expect(csv.text.trim().split('\n')).toHaveLength(2); // header + one row
    });
  });

  describe('integration log', () => {
    it('records Google Ads without a click id as skipped and does not retry it', async () => {
      const { formId } = seed();
      const integrationId = addIntegration(formId, 'google_ads_conversion', GOOGLE_ADS_CONFIG);
      const calls = mockGoogle();
      const res = await request(app).post('/api/public/form/ics01/submit').send({ data: { f_name: 'Ada' }, tracking: { utm_source: 'google' } });
      await settled(res.body.id);

      const row = getDb().prepare('SELECT * FROM integration_deliveries WHERE integration_id = ?').get(integrationId);
      expect(row.status).toBe('skipped');
      expect(JSON.parse(row.response).message).toMatch(/No Google Ads click ID/);
      expect(calls).toHaveLength(0);

      getDb().prepare("UPDATE integration_deliveries SET next_attempt_at = datetime('now', '-1 day')").run();
      await processDueDeliveries(getDb());
      expect(getDb().prepare('SELECT status FROM integration_deliveries WHERE id = ?').get(row.id).status).toBe('skipped');
    });

    it('acceptance: gclid=TEST123 + UTMs → detail log shows the upload failing for an invalid gclid, CSV carries it all', async () => {
      const { formId } = seed();
      addIntegration(formId, 'google_ads_conversion', GOOGLE_ADS_CONFIG);
      const calls = mockGoogle();
      const res = await request(app).post('/api/public/form/ics01/submit').send({
        data: { f_name: 'Ada', f_email: 'ada@example.com' },
        tracking: { gclid: 'TEST123', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test' },
      });
      expect(res.status).toBe(201);
      await settled(res.body.id);

      // Uploaded; the request carries the click id and no user data.
      const ingest = calls.find(c => c.url.includes('events:ingest'));
      expect(ingest.body.events[0].adIdentifiers).toEqual({ gclid: 'TEST123' });
      expect(JSON.stringify(ingest.body)).not.toContain('ada@example.com');
      let delivery = getDb().prepare('SELECT * FROM integration_deliveries WHERE submission_id = ?').get(res.body.id);
      expect(delivery.status).toBe('processing');
      expect(JSON.parse(delivery.response).requestId).toBe('req-123');

      // The status check is not due yet …
      await processDueStatusChecks(getDb());
      expect(calls.filter(c => c.url.includes('requestStatus'))).toHaveLength(0);
      // … and once it is, Google reports the gclid as undecodable.
      getDb().prepare("UPDATE integration_deliveries SET next_attempt_at = datetime('now', '-1 minute')").run();
      await processDueStatusChecks(getDb());
      const check = calls.find(c => c.url.includes('requestStatus:retrieve'));
      expect(check.url).toContain('requestId=req-123');
      delivery = getDb().prepare('SELECT * FROM integration_deliveries WHERE submission_id = ?').get(res.body.id);
      expect(delivery.status).toBe('failed');

      const cookie = await login(app);
      const log = await request(app).get(`/api/submissions/${formId}/${res.body.id}/integrations`).set('Cookie', cookie);
      expect(log.status).toBe(200);
      const [entry] = log.body.deliveries;
      expect(entry.type).toBe('google_ads_conversion');
      expect(entry.status).toBe('failed');
      expect(entry.response.message).toBe('Google rejected the conversion: invalid gclid');
      expect(entry.response.errorReasons).toEqual(['PROCESSING_ERROR_REASON_INVALID_GCLID']);
      expect(entry.log.map(l => [l.kind, l.status])).toEqual([['attempt', 'processing'], ['status_check', 'failed']]);
      expect(entry.log[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      // The log never holds respondent data.
      expect(JSON.stringify(log.body)).not.toContain('ada@example.com');

      const csv = await request(app).get(`/api/submissions/${formId}/export`).set('Cookie', cookie);
      const [header, row] = csv.text.split('\n');
      expect(header).toContain('"utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","gbraid","wbraid","fbc","Integration: Google Ads"');
      expect(row).toContain('"google","cpc","test","","","TEST123"');
      expect(row).toContain('"failed: Google rejected the conversion: invalid gclid"');
    });

    it('marks a conversion Google processed as uploaded', async () => {
      const { formId } = seed();
      addIntegration(formId, 'google_ads_conversion', GOOGLE_ADS_CONFIG);
      mockGoogle({ requestStatus: 'SUCCESS' });
      const res = await request(app).post('/api/public/form/ics01/submit').send({ data: { f_name: 'Ada' }, tracking: { gclid: 'real' } });
      await settled(res.body.id);
      getDb().prepare("UPDATE integration_deliveries SET next_attempt_at = datetime('now', '-1 minute')").run();
      await processDueStatusChecks(getDb());
      const row = getDb().prepare('SELECT status, response FROM integration_deliveries WHERE submission_id = ?').get(res.body.id);
      expect(row.status).toBe('success');
      expect(JSON.parse(row.response).requestStatus).toBe('SUCCESS');
    });

    it('keeps checking while Google is still processing, then gives up as unconfirmed', async () => {
      const { formId } = seed();
      addIntegration(formId, 'google_ads_conversion', GOOGLE_ADS_CONFIG);
      mockGoogle({ requestStatus: 'PROCESSING' });
      const res = await request(app).post('/api/public/form/ics01/submit').send({ data: { f_name: 'Ada' }, tracking: { gclid: 'real' } });
      await settled(res.body.id);
      const { STATUS_CHECK_DELAYS_MINUTES } = require('../src/models/deliveryQueue');
      for (let i = 0; i < STATUS_CHECK_DELAYS_MINUTES.length; i++) {
        getDb().prepare("UPDATE integration_deliveries SET next_attempt_at = datetime('now', '-1 minute')").run();
        await processDueStatusChecks(getDb());
      }
      const row = getDb().prepare('SELECT status, checks FROM integration_deliveries WHERE submission_id = ?').get(res.body.id);
      expect(row.status).toBe('unconfirmed');
      expect(row.checks).toBe(STATUS_CHECK_DELAYS_MINUTES.length);
    });

    it('logs webhook and Meta outcomes with safe summaries only', async () => {
      const { formId } = seed();
      const webhookId = addIntegration(formId, 'webhook', { url: 'https://hooks.example.com/x' });
      const metaId = addIntegration(formId, 'meta_conversion_api', { pixel_id: '1', access_token: 't' });
      jest.spyOn(require('dns').promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const sent = [];
      global.fetch = jest.fn(async (url, opts = {}) => {
        sent.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : undefined });
        if (String(url).includes('graph.facebook.com')) {
          return { ok: true, status: 200, json: async () => ({ events_received: 1, fbtrace_id: 'trace-1' }) };
        }
        return { ok: false, status: 500, text: async () => 'echo: ada@example.com', json: async () => ({}) };
      });
      const res = await request(app).post('/api/public/form/ics01/submit').send({
        data: { f_name: 'Ada', f_email: 'ada@example.com' },
        tracking: { utm_source: 'google', gclid: 'TEST123' },
      });
      await settled(res.body.id);
      require('dns').promises.lookup.mockRestore();

      // The webhook body carries the tracking object.
      const hook = sent.find(c => c.url.startsWith('https://hooks.example.com'));
      expect(hook.body.tracking).toMatchObject({ utm_source: 'google', gclid: 'TEST123', utm_medium: null });

      const rows = getDb().prepare('SELECT integration_id, status, response, last_error FROM integration_deliveries WHERE submission_id = ?').all(res.body.id);
      const webhook = rows.find(r => r.integration_id === webhookId);
      const meta = rows.find(r => r.integration_id === metaId);
      expect(webhook.status).toBe('retrying');
      expect(webhook.last_error).toBe('Webhook returned HTTP 500');
      expect(meta.status).toBe('success');
      expect(JSON.parse(meta.response)).toEqual({ message: 'Sent to Meta (1 event received)', eventsReceived: 1, fbtraceId: 'trace-1' });
      const logText = JSON.stringify(getDb().prepare('SELECT * FROM integration_delivery_log').all());
      expect(logText).not.toContain('ada@example.com');
      expect(logText).not.toMatch(/[0-9a-f]{64}/); // no hashed em/ph
    });

    it('deletes the integration log together with its submission', async () => {
      const { formId } = seed();
      addIntegration(formId, 'google_ads_conversion', GOOGLE_ADS_CONFIG);
      const res = await request(app).post('/api/public/form/ics01/submit').send({ data: { f_name: 'Ada' } });
      await settled(res.body.id);
      const cookie = await login(app);
      const del = await request(app).delete(`/api/submissions/${formId}/${res.body.id}`).set('Cookie', cookie);
      expect(del.status).toBe(200);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM integration_deliveries').get().n).toBe(0);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM integration_delivery_log').get().n).toBe(0);
    });

    it('refuses another owner\'s submission log', async () => {
      const { formId } = seed();
      const res = await request(app).post('/api/public/form/ics01/submit').send({ data: { f_name: 'Ada' } });
      const db = getDb();
      db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(uuid(), 'other@test.com', bcrypt.hashSync('otherpass1', 10), 'user');
      const other = await request(app).post('/api/auth/login').send({ email: 'other@test.com', password: 'otherpass1' });
      const log = await request(app).get(`/api/submissions/${formId}/${res.body.id}/integrations`).set('Cookie', other.headers['set-cookie']);
      expect(log.status).toBe(404);
    });
  });

  describe('Google Sheets columns', () => {
    function fakeSheets(existingHeader) {
      const writes = [];
      const api = {
        spreadsheets: {
          values: {
            get: jest.fn(async () => ({ data: { values: existingHeader ? [existingHeader] : undefined } })),
            update: jest.fn(async (req) => { writes.push({ op: 'update', values: req.requestBody.values[0] }); return {}; }),
            append: jest.fn(async (req) => { writes.push({ op: 'append', values: req.requestBody.values[0] }); return { data: { updates: { updatedRange: 'Sheet1!A2:L2' } } }; }),
          },
        },
      };
      jest.spyOn(google, 'sheets').mockReturnValue(api);
      return writes;
    }
    const sheetsIntegration = {
      id: 'int-sheets', type: 'google_sheets', enabled: 1,
      config: JSON.stringify({ credentials_json: '{}', spreadsheet_id: 'sheet' }),
    };
    afterEach(() => jest.restoreAllMocks());

    it('writes tracking headers into a new sheet', async () => {
      const writes = fakeSheets(null);
      const outcome = await runIntegration(sheetsIntegration, 'f', 'F', { f_name: 'Ada' }, steps, { utm_source: 'google', gclid: 'TEST123' });
      expect(writes[0].values).toEqual(['Timestamp', 'Name', 'Email', ...TRACKING_EXPORT_KEYS]);
      expect(writes[1].values.slice(1)).toEqual(['Ada', '', 'google', '', '', '', '', 'TEST123', '', '', '']);
      expect(outcome.message).toBe('Row appended (Sheet1!A2:L2)');
    });

    it('extends the header of an existing sheet without moving its columns', async () => {
      const writes = fakeSheets(['Timestamp', 'Name', 'Email']);
      await runIntegration(sheetsIntegration, 'f', 'F', { f_name: 'Ada' }, steps, { utm_campaign: 'test' });
      expect(writes[0]).toEqual({ op: 'update', values: ['Timestamp', 'Name', 'Email', ...TRACKING_EXPORT_KEYS] });
      expect(writes[1].values[5]).toBe('test');
    });

    it('leaves a header that already has the tracking columns alone', async () => {
      const writes = fakeSheets(['Timestamp', 'Name', 'Email', 'Notes', ...TRACKING_EXPORT_KEYS]);
      await runIntegration(sheetsIntegration, 'f', 'F', { f_name: 'Ada' }, steps, { utm_source: 'google' });
      expect(writes).toHaveLength(1);
      expect(writes[0].op).toBe('append');
      expect(writes[0].values[4]).toBe('google');
      expect(writes[0].values[3]).toBe('');
    });
  });

  it('enqueueAndAttempt passes the submission id but keeps it out of the log', async () => {
    const { formId } = seed();
    addIntegration(formId, 'google_ads_conversion', GOOGLE_ADS_CONFIG);
    mockGoogle();
    const db = getDb();
    db.prepare("INSERT INTO submissions (id, form_id, data, metadata) VALUES ('s1', ?, '{}', ?)").run(formId, JSON.stringify({ gclid: 'x', submittedAt: '2026-11-26T10:00:00.000Z' }));
    await enqueueAndAttempt(db, formId, 'F', 's1', {}, steps, { gclid: 'x', submittedAt: '2026-11-26T10:00:00.000Z' });
    const logRow = db.prepare('SELECT * FROM integration_delivery_log').get();
    expect(logRow.status).toBe('processing');
    expect(JSON.parse(logRow.response)).toEqual({ requestId: 'req-123' });
  });
});
