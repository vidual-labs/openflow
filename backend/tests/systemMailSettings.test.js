const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const systemMail = require('../src/models/systemMail');

function getDb() {
  return require('../src/models/db').getDb();
}

const PASSWORD = 'correct-horse-battery';
const SMTP_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];

function createUser(email, role = 'admin') {
  getDb().prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(uuid(), email, bcrypt.hashSync(PASSWORD, 10), role);
}

const SETTINGS = { host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, user: 'mailer@example.com', password: 's3cret-smtp-pass', from: 'OpenFlow <no-reply@example.com>' };

describe('System e-mail settings (admin UI)', () => {
  let app;
  let admin;
  let sent;
  let verifyError;
  let verified;

  beforeAll(() => {
    app = createTestApp();
    systemMail.setTransportForTests({
      sendMail: async (msg) => { sent.push(msg); },
      verify: async () => { verified += 1; if (verifyError) throw new Error(verifyError); return true; },
    });
  });

  afterAll(() => systemMail.setTransportForTests(null));

  beforeEach(async () => {
    for (const k of SMTP_ENV) delete process.env[k];
    sent = [];
    verifyError = null;
    verified = 0;
    getDb().prepare("DELETE FROM site_settings WHERE key = 'smtp'").run();
    createUser('admin@test.com');
    admin = request.agent(app);
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: PASSWORD });
  });

  afterEach(() => {
    for (const k of SMTP_ENV) delete process.env[k];
  });

  it('starts unconfigured and editable', async () => {
    const res = await admin.get('/api/admin/mail');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, locked: false, source: null });
  });

  it('saves after verifying, never returns the password, and stores it encrypted', async () => {
    const res = await admin.put('/api/admin/mail').send(SETTINGS);
    expect(res.status).toBe(200);
    expect(verified).toBe(1);
    expect(res.body).toMatchObject({ configured: true, source: 'ui', locked: false });
    expect(res.body.settings).toMatchObject({ host: 'smtp.example.com', port: 587, user: 'mailer@example.com', passwordSet: true });
    expect(JSON.stringify(res.body)).not.toContain('s3cret-smtp-pass');

    const raw = getDb().prepare("SELECT value FROM site_settings WHERE key = 'smtp'").get().value;
    expect(raw).not.toContain('s3cret-smtp-pass');
    expect(raw).not.toContain('smtp.example.com');

    const get = await admin.get('/api/admin/mail');
    expect(JSON.stringify(get.body)).not.toContain('s3cret-smtp-pass');
    expect(systemMail.mailConfig()).toMatchObject({ host: 'smtp.example.com', source: 'ui', auth: { user: 'mailer@example.com', pass: 's3cret-smtp-pass' } });
  });

  it('keeps the stored password when an update omits it, clears it with ""', async () => {
    await admin.put('/api/admin/mail').send(SETTINGS);
    const { password, ...withoutPassword } = SETTINGS;
    await admin.put('/api/admin/mail').send({ ...withoutPassword, port: 465, secure: true });
    expect(systemMail.mailConfig()).toMatchObject({ port: 465, secure: true, auth: { pass: 's3cret-smtp-pass' } });

    await admin.put('/api/admin/mail').send({ ...withoutPassword, password: '' });
    expect(systemMail.mailConfig().auth.pass).toBe('');
  });

  it('does not save settings the mail server rejects, unless told to', async () => {
    verifyError = '535 Authentication failed';
    const res = await admin.put('/api/admin/mail').send(SETTINGS);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('verify_failed');
    expect(res.body.error).toMatch(/535/);
    expect(systemMail.mailConfig()).toBeNull();

    const anyway = await admin.put('/api/admin/mail').send({ ...SETTINGS, skipVerify: true });
    expect(anyway.status).toBe(200);
    expect(systemMail.mailConfig()).not.toBeNull();
  });

  it('validates host, port and sender', async () => {
    expect((await admin.put('/api/admin/mail').send({ ...SETTINGS, host: '' })).status).toBe(400);
    expect((await admin.put('/api/admin/mail').send({ ...SETTINGS, host: 'bad host!' })).status).toBe(400);
    expect((await admin.put('/api/admin/mail').send({ ...SETTINGS, port: 70000 })).status).toBe(400);
    expect((await admin.put('/api/admin/mail').send({ ...SETTINGS, from: '', user: 'apikey' })).status).toBe(400);
    expect((await admin.put('/api/admin/mail').send({ ...SETTINGS, from: 'no address here' })).status).toBe(400);
  });

  it('makes two-factor login available and sends through the saved settings', async () => {
    expect((await admin.get('/api/auth/account')).body.twoFactor.available).toBe(false);
    await admin.put('/api/admin/mail').send(SETTINGS);
    expect((await admin.get('/api/auth/account')).body.twoFactor.available).toBe(true);

    const test = await admin.post('/api/admin/mail/test');
    expect(test.status).toBe(200);
    expect(sent[0]).toMatchObject({ to: 'admin@test.com', from: 'OpenFlow <no-reply@example.com>' });
  });

  it('can be removed again', async () => {
    await admin.put('/api/admin/mail').send(SETTINGS);
    const res = await admin.delete('/api/admin/mail');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(systemMail.mailConfig()).toBeNull();
  });

  it('SMTP_* in the environment wins and locks the UI', async () => {
    await admin.put('/api/admin/mail').send(SETTINGS);
    Object.assign(process.env, { SMTP_HOST: 'env-smtp.example.com', SMTP_FROM: 'env@example.com', SMTP_PASS: 'env-pass' });

    const get = await admin.get('/api/admin/mail');
    expect(get.body).toMatchObject({ source: 'env', locked: true, configured: true });
    expect(get.body.settings.host).toBe('env-smtp.example.com');
    expect(get.body.settings.passwordSet).toBe(true);
    expect(JSON.stringify(get.body)).not.toContain('env-pass');
    expect(systemMail.mailConfig().host).toBe('env-smtp.example.com');

    expect((await admin.put('/api/admin/mail').send(SETTINGS)).status).toBe(409);
    expect((await admin.delete('/api/admin/mail')).status).toBe(409);
  });

  it('refuses a host that resolves to the cloud metadata service', async () => {
    systemMail.setTransportForTests(null);
    try {
      const res = await admin.put('/api/admin/mail').send({ ...SETTINGS, host: '169.254.169.254' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/link-local|metadata/);
    } finally {
      systemMail.setTransportForTests({
        sendMail: async (msg) => { sent.push(msg); },
        verify: async () => { verified += 1; if (verifyError) throw new Error(verifyError); return true; },
      });
    }
  });

  it('is admin-only', async () => {
    createUser('user@test.com', 'user');
    const user = request.agent(app);
    await user.post('/api/auth/login').send({ email: 'user@test.com', password: PASSWORD });
    expect((await user.get('/api/admin/mail')).status).toBe(403);
    expect((await user.put('/api/admin/mail').send(SETTINGS)).status).toBe(403);
  });

  it('never appears in the public GET /api/settings', async () => {
    await admin.put('/api/admin/mail').send(SETTINGS);
    await admin.put('/api/settings/branding').send({ logoVisible: false, logoUrl: '' });
    const res = await request(app).get('/api/settings');
    expect(res.body.settings.smtp).toBeUndefined();
    expect(res.body.settings.branding).toMatchObject({ logoVisible: false });
  });
});
