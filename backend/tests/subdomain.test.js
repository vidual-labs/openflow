const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { createTestApp } = require('./setup');
const { validateSubdomain } = require('../src/utils/subdomain');
const { extractSubdomain, createSubdomainMiddleware } = require('../src/middleware/subdomain');

describe('Subdomain validation (unit)', () => {
  it('accepts well-formed labels', () => {
    expect(validateSubdomain('acme').ok).toBe(true);
    expect(validateSubdomain('my-tenant').ok).toBe(true);
    expect(validateSubdomain('a1b2c3').ok).toBe(true);
  });

  it('rejects short and long labels', () => {
    expect(validateSubdomain('ab').ok).toBe(false);
    expect(validateSubdomain('a'.repeat(61)).ok).toBe(false);
  });

  it('rejects uppercase, dots, underscores, leading/trailing hyphens', () => {
    expect(validateSubdomain('Acme').ok).toBe(false);
    expect(validateSubdomain('a.b').ok).toBe(false);
    expect(validateSubdomain('foo_bar').ok).toBe(false);
    expect(validateSubdomain('-acme').ok).toBe(false);
    expect(validateSubdomain('acme-').ok).toBe(false);
  });

  it('rejects reserved subdomains', () => {
    expect(validateSubdomain('www').ok).toBe(false);
    expect(validateSubdomain('api').ok).toBe(false);
    expect(validateSubdomain('admin').ok).toBe(false);
    expect(validateSubdomain('mail').ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(validateSubdomain(123).ok).toBe(false);
    expect(validateSubdomain(null).ok).toBe(false);
  });
});

describe('extractSubdomain (unit)', () => {
  it('returns null when hostname equals the primary host', () => {
    expect(extractSubdomain('forms.example.com', 'forms.example.com')).toBeNull();
  });

  it('extracts a single-label prefix', () => {
    expect(extractSubdomain('acme.forms.example.com', 'forms.example.com')).toBe('acme');
  });

  it('lowercases the result and matches case-insensitively', () => {
    expect(extractSubdomain('ACME.FORMS.EXAMPLE.COM', 'forms.example.com')).toBe('acme');
  });

  it('returns null for unrelated hostnames', () => {
    expect(extractSubdomain('evil.com', 'forms.example.com')).toBeNull();
  });

  it('rejects nested subdomains (more than one label deep)', () => {
    expect(extractSubdomain('a.b.forms.example.com', 'forms.example.com')).toBeNull();
  });

  it('handles missing inputs', () => {
    expect(extractSubdomain('', 'forms.example.com')).toBeNull();
    expect(extractSubdomain('acme.forms.example.com', '')).toBeNull();
  });
});

describe('PUT /api/forms/:id with subdomain (integration)', () => {
  let app;
  let cookie;
  let userId;
  let formId;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    const db = require('../src/models/db').getDb();
    db.pragma('foreign_keys = OFF');
    db.exec('DELETE FROM slug_history');
    db.pragma('foreign_keys = ON');

    userId = uuid();
    const hash = bcrypt.hashSync('userpass', 10);
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(userId, 'subdomain-tester@test.com', hash, 'user');

    const login = await request(app).post('/api/auth/login').send({ email: 'subdomain-tester@test.com', password: 'userpass' });
    cookie = login.headers['set-cookie'];

    const created = await request(app)
      .post('/api/forms')
      .set('Cookie', cookie)
      .send({ title: 'Test Form' });
    formId = created.body.form.id;
  });

  it('sets a subdomain on the form', async () => {
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ subdomain: 'acme' });
    expect(res.status).toBe(200);
    expect(res.body.form.subdomain).toBe('acme');
  });

  it('normalises uppercase and whitespace', async () => {
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ subdomain: '  Acme  ' });
    expect(res.status).toBe(200);
    expect(res.body.form.subdomain).toBe('acme');
  });

  it('rejects invalid characters with 400', async () => {
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ subdomain: 'in valid' });
    expect(res.status).toBe(400);
  });

  it('rejects reserved labels with 400', async () => {
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ subdomain: 'www' });
    expect(res.status).toBe(400);
  });

  it('rejects a subdomain claimed by another form with 409', async () => {
    const other = await request(app).post('/api/forms').set('Cookie', cookie).send({ title: 'Other' });
    await request(app)
      .put(`/api/forms/${other.body.form.id}`)
      .set('Cookie', cookie)
      .send({ subdomain: 'taken' });

    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ subdomain: 'taken' });
    expect(res.status).toBe(409);
  });

  it('clears the subdomain when null is sent', async () => {
    await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ subdomain: 'temp' });
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ subdomain: null });
    expect(res.status).toBe(200);
    expect(res.body.form.subdomain).toBeNull();
  });

  it('clears the subdomain when empty string is sent', async () => {
    await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ subdomain: 'temp' });
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ subdomain: '' });
    expect(res.status).toBe(200);
    expect(res.body.form.subdomain).toBeNull();
  });

  it('allows the same form to keep its subdomain across other updates', async () => {
    await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ subdomain: 'acme' });
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ title: 'New Title' });
    expect(res.status).toBe(200);
    expect(res.body.form.subdomain).toBe('acme');
  });

  it('exposes primaryHost in the settings response when set', async () => {
    process.env.OPENFLOW_PRIMARY_HOST = 'forms.example.com';
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.primaryHost).toBe('forms.example.com');
    delete process.env.OPENFLOW_PRIMARY_HOST;
  });

  it('returns null primaryHost when OPENFLOW_PRIMARY_HOST is not set', async () => {
    delete process.env.OPENFLOW_PRIMARY_HOST;
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.primaryHost).toBeNull();
  });
});

describe('Subdomain middleware (integration)', () => {
  let app;
  let formId;
  let formSlug;
  let userId;

  beforeAll(() => {
    process.env.OPENFLOW_PRIMARY_HOST = 'forms.example.com';

    // Build a tiny app that only includes the middleware and stub handlers
    // so we can inspect what gets routed through and what gets 404'd.
    app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(createSubdomainMiddleware());

    // Stand-ins for the real routes.
    app.get('/api/forms', (req, res) => res.json({ ok: true, area: 'admin' }));
    app.get('/api/public/form/:slug', (req, res) => res.json({ ok: true, area: 'public', slug: req.params.slug }));
    app.get('*', (req, res) => {
      if (req.subdomainForm) {
        return res.type('html').send(`<!doctype html><script>window.__OPENFLOW_HOST_FORM__={"slug":"${req.subdomainForm.slug}"};</script>`);
      }
      res.type('html').send('<!doctype html><body>admin</body>');
    });
  });

  afterAll(() => {
    delete process.env.OPENFLOW_PRIMARY_HOST;
  });

  beforeEach(() => {
    const db = require('../src/models/db').getDb();
    userId = uuid();
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(userId, 'sd-mw@test.com', bcrypt.hashSync('p', 10), 'user');

    formId = uuid();
    formSlug = `sub-${Date.now().toString(36)}`;
    db.prepare(
      'INSERT INTO forms (id, user_id, title, slug, subdomain, published) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(formId, userId, 'Acme Form', formSlug, 'acme');
  });

  it('passes through requests on the primary host unchanged', async () => {
    const res = await request(app).get('/').set('Host', 'forms.example.com');
    expect(res.status).toBe(200);
    expect(res.text).toContain('admin');
  });

  it('serves form HTML with injected slug on a known subdomain', async () => {
    const res = await request(app).get('/').set('Host', 'acme.forms.example.com');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"slug":"${formSlug}"`);
  });

  it('serves the injected HTML for /index.html too (not the raw file)', async () => {
    // Stand-in catch-all for this test ignores trailing path segments, so we
    // only need to verify the rewrite happened by checking the response body.
    const res = await request(app).get('/index.html').set('Host', 'acme.forms.example.com');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"slug":"${formSlug}"`);
  });

  it('returns 404 plain text when no form claims the subdomain', async () => {
    const res = await request(app).get('/').set('Host', 'nobody.forms.example.com');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the form exists but is unpublished', async () => {
    const db = require('../src/models/db').getDb();
    db.prepare('UPDATE forms SET published = 0 WHERE id = ?').run(formId);
    const res = await request(app).get('/').set('Host', 'acme.forms.example.com');
    expect(res.status).toBe(404);
  });

  it('blocks admin APIs on a subdomain', async () => {
    const res = await request(app).get('/api/forms').set('Host', 'acme.forms.example.com');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not available on this hostname');
  });

  it('allows public APIs on a subdomain', async () => {
    const res = await request(app).get(`/api/public/form/${formSlug}`).set('Host', 'acme.forms.example.com');
    expect(res.status).toBe(200);
    expect(res.body.area).toBe('public');
  });

  it('treats www as the primary host (no subdomain)', async () => {
    const res = await request(app).get('/').set('Host', 'www.forms.example.com');
    expect(res.status).toBe(200);
    expect(res.text).toContain('admin');
  });

  it('rejects nested subdomains as not-matching the pattern', async () => {
    // a.b.forms.example.com does NOT route through subdomain logic, so the
    // admin HTML is served (and admin APIs aren't blocked). This is the
    // safe default — only single-label tenants are valid.
    const res = await request(app).get('/').set('Host', 'a.b.forms.example.com');
    expect(res.status).toBe(200);
    expect(res.text).toContain('admin');
  });
});
