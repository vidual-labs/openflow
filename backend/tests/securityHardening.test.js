const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const secureDefaults = require('../src/models/secureDefaults');
const { resolveTrustProxy } = require('../src/utils/trustProxy');

function db() {
  return require('../src/models/db').getDb();
}

function insertUser(email, password, role = 'admin') {
  const id = uuid();
  db().prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(id, email, bcrypt.hashSync(password, 4), role);
  return id;
}

describe('Security hardening', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    secureDefaults.resetWeakPasswordFlags();
  });

  async function login(email, password) {
    return request(app).post('/api/auth/login').send({ email, password });
  }

  describe('API tokens never inherit admin rights', () => {
    let token;

    beforeEach(async () => {
      insertUser('admin@test.com', 'a-strong-password');
      const cookie = (await login('admin@test.com', 'a-strong-password')).headers['set-cookie'];
      const res = await request(app).post('/api/auth/tokens').set('Cookie', cookie).send({ name: 'lodgely' });
      token = res.body.token.token;
    });

    it.each([
      '/api/admin/backup',
      '/api/admin/backup/info',
      '/api/admin/audit-log',
      '/api/auth/users',
    ])('rejects an admin-owned token on %s', async (path) => {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/API tokens/);
    });

    it('still lets the token read forms (the lodgely connector path)', async () => {
      const res = await request(app).get('/api/forms').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('still lets an admin session reach admin endpoints', async () => {
      const cookie = (await login('admin@test.com', 'a-strong-password')).headers['set-cookie'];
      const res = await request(app).get('/api/admin/audit-log').set('Cookie', cookie);
      expect(res.status).toBe(200);
    });
  });

  describe('public submit', () => {
    function insertForm(endScreen = {}) {
      const userId = insertUser(`owner-${uuid()}@test.com`, 'irrelevant-pass', 'user');
      const steps = [{ id: 'f_email', type: 'email', question: 'Email', required: true }];
      db().prepare('INSERT INTO forms (id, user_id, title, slug, steps, end_screen, published) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(uuid(), userId, 'Lead form', 'lead-form', JSON.stringify(steps), JSON.stringify(endScreen));
    }

    function storedData() {
      return JSON.parse(db().prepare('SELECT data FROM submissions').get().data);
    }

    it('drops client-supplied underscore keys other than _consent', async () => {
      insertForm();
      const res = await request(app).post('/api/public/form/lead-form/submit')
        .send({ data: { f_email: 'a@b.de', _injected: '<script>', _consent: true } });
      expect(res.status).toBe(201);
      expect(storedData()).toEqual({ f_email: 'a@b.de' });
    });

    it('rejects a submission without consent when the form asks for it', async () => {
      insertForm({ consentEnabled: true });
      const missing = await request(app).post('/api/public/form/lead-form/submit').send({ data: { f_email: 'a@b.de' } });
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('consent_required');

      const declined = await request(app).post('/api/public/form/lead-form/submit').send({ data: { f_email: 'a@b.de', _consent: false } });
      expect(declined.status).toBe(400);
    });

    it('stores consent when given', async () => {
      insertForm({ consentEnabled: true });
      const res = await request(app).post('/api/public/form/lead-form/submit').send({ data: { f_email: 'a@b.de', _consent: true } });
      expect(res.status).toBe(201);
      expect(storedData()._consent).toBe(true);
    });
  });

  describe('operator-supplied links', () => {
    let cookie;
    let formId;

    beforeEach(async () => {
      insertUser('editor@test.com', 'a-strong-password', 'user');
      cookie = (await login('editor@test.com', 'a-strong-password')).headers['set-cookie'];
      formId = (await request(app).post('/api/forms').set('Cookie', cookie).send({ title: 'Links' })).body.form.id;
    });

    it('rejects a javascript: redirect URL', async () => {
      const res = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie)
        .send({ end_screen: { redirectUrl: 'java\tscript:alert(1)', autoRedirect: true } });
      expect(res.status).toBe(400);
    });

    it('rejects a javascript: footer link', async () => {
      const res = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie)
        .send({ theme: { footerLinks: [{ title: 'Privacy', url: 'javascript:alert(1)' }] } });
      expect(res.status).toBe(400);
    });

    it('accepts https, mailto and relative links', async () => {
      const res = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({
        end_screen: { redirectUrl: 'https://example.com/thanks' },
        theme: { footerLinks: [{ title: 'Mail', url: 'mailto:hi@example.com' }, { title: 'Imprint', url: '/imprint' }] },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('weak and default passwords', () => {
    it('flags a login with the old default password and clears it after a change', async () => {
      const id = insertUser('old@test.com', 'admin123');
      const res = await login('old@test.com', 'admin123');
      expect(res.status).toBe(200);
      expect(res.body.user.weakPassword).toBe(true);

      const cookie = res.headers['set-cookie'];
      const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(me.body.user.weakPassword).toBe(true);

      const change = await request(app).put(`/api/auth/users/${id}`).set('Cookie', cookie).send({ password: 'a-much-better-passphrase' });
      expect(change.status).toBe(200);
      const relogin = await login('old@test.com', 'a-much-better-passphrase');
      expect(relogin.body.user.weakPassword).toBe(false);
    });

    it('refuses to set a well-known default as a new password', async () => {
      const id = insertUser('admin2@test.com', 'a-strong-password');
      const cookie = (await login('admin2@test.com', 'a-strong-password')).headers['set-cookie'];
      const res = await request(app).put(`/api/auth/users/${id}`).set('Cookie', cookie).send({ password: '1234567890' });
      expect(res.status).toBe(400);
    });

    it('finds admins that still use a default password at boot', async () => {
      insertUser('legacy@test.com', 'admin123');
      insertUser('fine@test.com', 'a-strong-password');
      insertUser('editor@test.com', 'admin123', 'user');
      const found = await secureDefaults.scanForDefaultPasswords(db());
      expect(found).toEqual(['legacy@test.com']);
    });

    it('refuses to seed the first admin with a weak ADMIN_PASSWORD', () => {
      expect(() => secureDefaults.assertSeedPasswordStrong('admin123')).toThrow(/ADMIN_PASSWORD/);
      expect(() => secureDefaults.assertSeedPasswordStrong('short')).toThrow(/ADMIN_PASSWORD/);
      expect(() => secureDefaults.assertSeedPasswordStrong(undefined)).not.toThrow();
      expect(() => secureDefaults.assertSeedPasswordStrong('a-strong-password')).not.toThrow();
    });
  });

  describe('JWT secret', () => {
    it('refuses a publicly known secret', () => {
      expect(() => secureDefaults.checkJwtSecret({ JWT_SECRET: 'change-me-in-production' })).toThrow(/JWT_SECRET/);
    });

    it('warns about a short secret', () => {
      expect(secureDefaults.checkJwtSecret({ JWT_SECRET: 'tooshort' })).toHaveLength(1);
    });

    it('accepts an unset or long random secret', () => {
      expect(secureDefaults.checkJwtSecret({})).toEqual([]);
      expect(secureDefaults.checkJwtSecret({ JWT_SECRET: 'f'.repeat(64) })).toEqual([]);
    });
  });

  describe('TRUST_PROXY', () => {
    it('is off by default and on for subdomain deployments', () => {
      expect(resolveTrustProxy({})).toBe(false);
      expect(resolveTrustProxy({ OPENFLOW_PRIMARY_HOST: 'forms.example.com' })).toBe(1);
    });

    it('parses hop counts, booleans and address lists', () => {
      expect(resolveTrustProxy({ TRUST_PROXY: '2' })).toBe(2);
      expect(resolveTrustProxy({ TRUST_PROXY: 'true' })).toBe(true);
      expect(resolveTrustProxy({ TRUST_PROXY: 'false', OPENFLOW_PRIMARY_HOST: 'x' })).toBe(false);
      expect(resolveTrustProxy({ TRUST_PROXY: 'loopback, 10.0.0.0/8' })).toEqual(['loopback', '10.0.0.0/8']);
    });
  });
});
