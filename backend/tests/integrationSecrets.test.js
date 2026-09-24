const request = require('supertest');
const bcrypt = require('bcryptjs');
const dns = require('dns');
const nodemailer = require('nodemailer');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const { decrypt } = require('../src/models/encryption');
const { runIntegration } = require('../src/models/integrations');

function getDb() {
  return require('../src/models/db').getDb();
}

const SA_KEY = {
  type: 'service_account',
  client_email: 'sheets@project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIsecret\n-----END PRIVATE KEY-----\n',
};

describe('integration secrets are write-only', () => {
  let app;
  let cookie;
  let formId;

  beforeAll(() => { app = createTestApp(); });

  beforeEach(async () => {
    const db = getDb();
    const userId = uuid();
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(userId, 'owner@test.com', bcrypt.hashSync('ownerpass', 10), 'admin');
    formId = uuid();
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps) VALUES (?, ?, ?, ?, ?)')
      .run(formId, userId, 'Secrets', `secrets-${formId.slice(0, 8)}`, '[]');
    const res = await request(app).post('/api/auth/login').send({ email: 'owner@test.com', password: 'ownerpass' });
    cookie = res.headers['set-cookie'];
  });

  function storedConfig(id) {
    return JSON.parse(decrypt(getDb().prepare('SELECT config FROM integrations WHERE id = ?').get(id).config));
  }

  async function createEmail() {
    const res = await request(app).post(`/api/integrations/${formId}`).set('Cookie', cookie).send({
      type: 'email',
      config: { smtp_host: 'smtp.example.com', smtp_user: 'u', smtp_pass: 'hunter2', to: 'a@b.de' },
    });
    expect(res.status).toBe(201);
    return res.body.integration;
  }

  it('never returns secrets on create or list', async () => {
    const created = await createEmail();
    expect(created.config).toEqual({ smtp_host: 'smtp.example.com', smtp_user: 'u', to: 'a@b.de' });
    expect(created.secrets).toEqual({ smtp_pass: { set: true } });

    const list = await request(app).get(`/api/integrations/${formId}`).set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('hunter2');
    expect(list.body.integrations[0].secrets.smtp_pass.set).toBe(true);
  });

  it('does not hand secrets to read-only API tokens either', async () => {
    await createEmail();
    const tokenRes = await request(app).post('/api/auth/tokens').set('Cookie', cookie).send({ name: 'lodgely' });
    const token = tokenRes.body.token.token;

    const res = await request(app).get(`/api/integrations/${formId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('keeps a stored secret when an update omits it', async () => {
    const created = await createEmail();
    const res = await request(app).put(`/api/integrations/${formId}/${created.id}`).set('Cookie', cookie)
      .send({ config: { ...created.config, to: 'new@b.de' } });
    expect(res.status).toBe(200);
    expect(res.body.integration.config.to).toBe('new@b.de');
    expect(res.body.integration.secrets.smtp_pass.set).toBe(true);
    expect(storedConfig(created.id)).toMatchObject({ smtp_pass: 'hunter2', to: 'new@b.de' });
  });

  it('replaces a secret when a new value is sent and clears it on null', async () => {
    const created = await createEmail();
    await request(app).put(`/api/integrations/${formId}/${created.id}`).set('Cookie', cookie)
      .send({ config: { ...created.config, smtp_pass: 'correct-horse' } });
    expect(storedConfig(created.id).smtp_pass).toBe('correct-horse');

    const res = await request(app).put(`/api/integrations/${formId}/${created.id}`).set('Cookie', cookie)
      .send({ config: { ...created.config, smtp_pass: null } });
    expect(res.body.integration.secrets.smtp_pass.set).toBe(false);
    expect(storedConfig(created.id)).not.toHaveProperty('smtp_pass');
  });

  it('hides the service-account key but shows its client email', async () => {
    const res = await request(app).post(`/api/integrations/${formId}`).set('Cookie', cookie).send({
      type: 'google_sheets',
      config: { mode: 'service_account', spreadsheet_id: 'sheet', credentials_json: SA_KEY },
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    expect(res.body.integration.secrets.credentials_json).toEqual({ set: true, hint: SA_KEY.client_email });
  });

  it('refuses to overwrite a config it cannot decrypt', async () => {
    const created = await createEmail();
    getDb().prepare('UPDATE integrations SET config = ? WHERE id = ?').run('enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', created.id);

    const list = await request(app).get(`/api/integrations/${formId}`).set('Cookie', cookie);
    expect(list.body.integrations[0].config_error).toMatch(/ENCRYPTION_KEY/);

    const res = await request(app).put(`/api/integrations/${formId}/${created.id}`).set('Cookie', cookie)
      .send({ config: { to: 'x@y.de' } });
    expect(res.status).toBe(409);
    expect(getDb().prepare('SELECT config FROM integrations WHERE id = ?').get(created.id).config)
      .toBe('enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    // Toggling enabled doesn't touch the config and still works.
    const toggle = await request(app).put(`/api/integrations/${formId}/${created.id}`).set('Cookie', cookie)
      .send({ enabled: false });
    expect(toggle.status).toBe(200);
  });

  it('rejects a non-object config', async () => {
    const created = await createEmail();
    const res = await request(app).put(`/api/integrations/${formId}/${created.id}`).set('Cookie', cookie)
      .send({ config: 'nope' });
    expect(res.status).toBe(400);
    expect(storedConfig(created.id).smtp_pass).toBe('hunter2');
  });
});

describe('Meta access token transport', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('sends the access token in a header, not the URL', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, text: async () => '' };
    });
    await runIntegration(
      { id: 'm', type: 'meta_conversion_api', config: JSON.stringify({ pixel_id: '123', access_token: 'tok-secret' }) },
      'form-1', 'Form', {}, [], { submissionId: 's' }
    );
    expect(calls[0].url).not.toContain('tok-secret');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer tok-secret');
  });
});

describe('SMTP host SSRF guard', () => {
  const email = (host) => ({
    id: 'e', type: 'email', config: JSON.stringify({ smtp_host: host, to: 'a@b.de' }),
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SMTP_BLOCK_PRIVATE_HOSTS;
  });

  function mockTransport() {
    const opts = [];
    jest.spyOn(nodemailer, 'createTransport').mockImplementation((o) => {
      opts.push(o);
      return { sendMail: async () => ({}) };
    });
    return opts;
  }

  it('always rejects the metadata service and other link-local hosts', async () => {
    const opts = mockTransport();
    for (const host of ['169.254.169.254', '0.0.0.0', 'fe80::1']) {
      await expect(runIntegration(email(host), 'f', 'F', {}, [])).rejects.toThrow(/SMTP host rejected/);
    }
    expect(opts).toHaveLength(0);
  });

  it('keeps internal mail relays working by default', async () => {
    const opts = mockTransport();
    for (const host of ['127.0.0.1', '10.0.0.5', '192.168.1.20']) {
      await runIntegration(email(host), 'f', 'F', {}, []);
    }
    expect(opts.map(o => o.host)).toEqual(['127.0.0.1', '10.0.0.5', '192.168.1.20']);
  });

  it('leaves unresolvable hosts to nodemailer', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    const opts = mockTransport();
    await runIntegration(email('postfix'), 'f', 'F', {}, []);
    expect(opts[0].host).toBe('postfix');
  });

  describe('with SMTP_BLOCK_PRIVATE_HOSTS=true', () => {
    beforeEach(() => { process.env.SMTP_BLOCK_PRIVATE_HOSTS = 'true'; });

    it('rejects private and loopback hosts', async () => {
      const opts = mockTransport();
      for (const host of ['127.0.0.1', 'localhost', '10.0.0.5']) {
        await expect(runIntegration(email(host), 'f', 'F', {}, [])).rejects.toThrow(/SMTP host rejected/);
      }
      expect(opts).toHaveLength(0);
    });

    it('connects to the checked address and keeps the hostname for TLS', async () => {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '2606:2800:220:1::1', family: 6 },
        { address: '93.184.216.34', family: 4 },
      ]);
      const opts = mockTransport();
      await runIntegration(email('smtp.example.com'), 'f', 'F', {}, []);
      expect(opts[0]).toMatchObject({ host: '93.184.216.34', servername: 'smtp.example.com' });
    });
  });
});
