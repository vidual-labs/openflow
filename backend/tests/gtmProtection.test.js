const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const apiTokens = require('../src/models/apiTokens');

// A form's Google Tag Manager container is third-party script that runs on
// the same origin as the admin app. These tests cover the two guards around
// it: GTM is never handed to a browser that is signed in to OpenFlow (B1),
// and only admins may set or change a form's container (B2).

function getDb() {
  return require('../src/models/db').getDb();
}

const PASSWORD = 'correct-horse-battery';
const GTM = 'GTM-TEST123';

function createUser(email, role = 'user') {
  const id = uuid();
  getDb().prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(id, email, bcrypt.hashSync(PASSWORD, 10), role);
  return id;
}

function createForm(userId, { slug = 'gtm-form', gtmId = GTM, published = 1 } = {}) {
  const id = uuid();
  getDb().prepare(
    'INSERT INTO forms (id, user_id, title, slug, steps, end_screen, theme, gtm_id, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, 'Tracked form', slug,
    JSON.stringify([{ id: 'f1', key: 'name', type: 'text', label: 'Name' }]),
    JSON.stringify({ title: 'Thanks', cookieConsentEnabled: true }),
    JSON.stringify({ language: 'en' }),
    gtmId, published);
  return id;
}

function storedGtm(formId) {
  return getDb().prepare('SELECT gtm_id FROM forms WHERE id = ?').get(formId).gtm_id;
}

describe('GTM protection', () => {
  let app;

  beforeAll(() => { app = createTestApp(); });

  async function sessionCookie(email) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'].find(c => c.startsWith('token=')).split(';')[0];
  }

  describe('B1: GET /api/public/form/:slug leaves GTM out for signed-in browsers', () => {
    function expectPrivateNoStore(res) {
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers.vary).toMatch(/\bCookie\b/);
    }

    it('serves the GTM container to a signed-out visitor, with the same shape as before', async () => {
      const owner = createUser('owner@test.com');
      createForm(owner);

      const res = await request(app).get('/api/public/form/gtm-form');
      expect(res.status).toBe(200);
      expect(res.body.form.gtm_id).toBe(GTM);
      expect(Object.keys(res.body)).toEqual(['form']);
      expect(Object.keys(res.body.form).sort()).toEqual(['end_screen', 'gtm_id', 'id', 'slug', 'steps', 'theme', 'title']);
      expect(res.body.form).not.toHaveProperty('gtmSuppressed');
      expectPrivateNoStore(res);
    });

    it('blanks the container and flags it for a browser with a valid session cookie', async () => {
      const owner = createUser('owner@test.com');
      createUser('someone@test.com');
      createForm(owner);

      const signedOut = await request(app).get('/api/public/form/gtm-form');
      for (const email of ['owner@test.com', 'someone@test.com']) {
        const cookie = await sessionCookie(email);
        const res = await request(app).get('/api/public/form/gtm-form').set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.form.gtm_id).toBe('');
        expect(res.body.form.gtmSuppressed).toBe(true);
        expectPrivateNoStore(res);
        // Everything else is exactly what a visitor gets.
        const { gtm_id: _a, gtmSuppressed: _b, ...rest } = res.body.form;
        const { gtm_id: _c, ...visitorRest } = signedOut.body.form;
        expect(rest).toEqual(visitorRest);
      }
    });

    it('also blanks it when the form is reached through an old slug (slug_history)', async () => {
      const owner = createUser('owner@test.com');
      const formId = createForm(owner, { slug: 'new-slug' });
      getDb().prepare('INSERT INTO slug_history (old_slug, form_id) VALUES (?, ?)').run('old-slug', formId);

      const visitor = await request(app).get('/api/public/form/old-slug');
      expect(visitor.status).toBe(200);
      expect(visitor.body.form.slug).toBe('new-slug');
      expect(visitor.body.form.gtm_id).toBe(GTM);
      expectPrivateNoStore(visitor);

      const cookie = await sessionCookie('owner@test.com');
      const res = await request(app).get('/api/public/form/old-slug').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.form.slug).toBe('new-slug');
      expect(res.body.form.gtm_id).toBe('');
      expect(res.body.form.gtmSuppressed).toBe(true);
      expectPrivateNoStore(res);
    });

    it('only trusts a live session cookie, not a Bearer header, an API token or a stale cookie', async () => {
      const owner = createUser('owner@test.com');
      createForm(owner);
      const cookie = await sessionCookie('owner@test.com');
      const raw = cookie.slice('token='.length);
      const { token } = apiTokens.createToken(owner, 'lodgely');

      const bearer = await request(app).get('/api/public/form/gtm-form').set('Authorization', `Bearer ${raw}`);
      expect(bearer.body.form.gtm_id).toBe(GTM);
      const apiToken = await request(app).get('/api/public/form/gtm-form').set('Authorization', `Bearer ${token}`);
      expect(apiToken.body.form.gtm_id).toBe(GTM);
      const tokenCookie = await request(app).get('/api/public/form/gtm-form').set('Cookie', `token=${token}`);
      expect(tokenCookie.body.form.gtm_id).toBe(GTM);
      const bogus = await request(app).get('/api/public/form/gtm-form').set('Cookie', 'token=not-a-session');
      expect(bogus.body.form.gtm_id).toBe(GTM);
      expect(bogus.body.form).not.toHaveProperty('gtmSuppressed');

      await request(app).post('/api/auth/logout').set('Cookie', cookie);
      const loggedOut = await request(app).get('/api/public/form/gtm-form').set('Cookie', cookie);
      expect(loggedOut.body.form.gtm_id).toBe(GTM);
      expect(loggedOut.body.form).not.toHaveProperty('gtmSuppressed');
    });

    it('does not flag a form that has no container in the first place', async () => {
      const owner = createUser('owner@test.com');
      createForm(owner, { gtmId: '' });
      const cookie = await sessionCookie('owner@test.com');
      const res = await request(app).get('/api/public/form/gtm-form').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.form.gtm_id).toBe('');
      expect(res.body.form).not.toHaveProperty('gtmSuppressed');
      expectPrivateNoStore(res);
    });

    it('the session cookie stays host-only, so per-form subdomains never receive it', async () => {
      createUser('owner@test.com');
      const res = await request(app).post('/api/auth/login').send({ email: 'owner@test.com', password: PASSWORD });
      const cookie = res.headers['set-cookie'].find(c => c.startsWith('token='));
      expect(cookie).not.toMatch(/;\s*Domain=/i);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
    });

    it('keeps the response uncacheable when the form does not exist', async () => {
      const res = await request(app).get('/api/public/form/nope');
      expect(res.status).toBe(404);
      expectPrivateNoStore(res);
    });
  });

  describe('B2: only admins set or change a form\'s GTM container', () => {
    it('refuses a non-admin creating a form with a container', async () => {
      createUser('user@test.com');
      const cookie = await sessionCookie('user@test.com');
      const res = await request(app).post('/api/forms').set('Cookie', cookie).send({ title: 'Mine', gtm_id: GTM });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('gtm_admin_only');
      expect(res.body.error).toMatch(/admin/i);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM forms').get().n).toBe(0);
    });

    it('lets a non-admin create a form without one', async () => {
      createUser('user@test.com');
      const cookie = await sessionCookie('user@test.com');
      for (const body of [{ title: 'A' }, { title: 'B', gtm_id: '' }, { title: 'C', gtm_id: null }]) {
        const res = await request(app).post('/api/forms').set('Cookie', cookie).send(body);
        expect(res.status).toBe(201);
        expect(res.body.form.gtm_id).toBe('');
      }
    });

    it('lets an admin create a form with one (and still validates it)', async () => {
      createUser('admin@test.com', 'admin');
      const cookie = await sessionCookie('admin@test.com');
      const res = await request(app).post('/api/forms').set('Cookie', cookie).send({ title: 'Tracked', gtm_id: GTM });
      expect(res.status).toBe(201);
      expect(res.body.form.gtm_id).toBe(GTM);
      const bad = await request(app).post('/api/forms').set('Cookie', cookie).send({ title: 'Bad', gtm_id: 'GTM-1\'</script>' });
      expect(bad.status).toBe(400);
    });

    it('refuses a non-admin adding or changing a container, and changes nothing else either', async () => {
      const userId = createUser('user@test.com');
      const withGtm = createForm(userId, { slug: 'with-gtm' });
      const without = createForm(userId, { slug: 'without-gtm', gtmId: '' });
      const cookie = await sessionCookie('user@test.com');

      const change = await request(app).put(`/api/forms/${withGtm}`).set('Cookie', cookie)
        .send({ title: 'Renamed', slug: 'moved-away', gtm_id: 'GTM-OTHER1' });
      expect(change.status).toBe(403);
      expect(change.body.code).toBe('gtm_admin_only');
      const row = getDb().prepare('SELECT title, slug, gtm_id FROM forms WHERE id = ?').get(withGtm);
      expect(row).toEqual({ title: 'Tracked form', slug: 'with-gtm', gtm_id: GTM });

      const add = await request(app).put(`/api/forms/${without}`).set('Cookie', cookie).send({ gtm_id: GTM });
      expect(add.status).toBe(403);
      expect(add.body.code).toBe('gtm_admin_only');
      expect(storedGtm(without)).toBe('');
    });

    it('lets a non-admin keep saving a form that already has a container', async () => {
      const userId = createUser('user@test.com');
      const formId = createForm(userId);
      const cookie = await sessionCookie('user@test.com');

      // The editor sends the whole payload, GTM included.
      const res = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ title: 'Edited', gtm_id: GTM });
      expect(res.status).toBe(200);
      expect(res.body.form.title).toBe('Edited');
      expect(res.body.form.gtm_id).toBe(GTM);

      const omitted = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ title: 'Again' });
      expect(omitted.status).toBe(200);
      const nulled = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ gtm_id: null });
      expect(nulled.status).toBe(200);
      expect(storedGtm(formId)).toBe(GTM);
    });

    it('lets a non-admin remove a container', async () => {
      const userId = createUser('user@test.com');
      const formId = createForm(userId);
      const cookie = await sessionCookie('user@test.com');

      const res = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ gtm_id: '' });
      expect(res.status).toBe(200);
      expect(storedGtm(formId)).toBe('');
      // ...and cannot put it back.
      const back = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ gtm_id: GTM });
      expect(back.status).toBe(403);
    });

    it('lets an admin change and clear a container', async () => {
      const adminId = createUser('admin@test.com', 'admin');
      const formId = createForm(adminId);
      const cookie = await sessionCookie('admin@test.com');

      const change = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ gtm_id: 'GTM-OTHER1' });
      expect(change.status).toBe(200);
      expect(storedGtm(formId)).toBe('GTM-OTHER1');
      const clear = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ gtm_id: '' });
      expect(clear.status).toBe(200);
      expect(storedGtm(formId)).toBe('');
    });

    it('keeps the source\'s container when a non-admin clones a form', async () => {
      const userId = createUser('user@test.com');
      const formId = createForm(userId);
      const cookie = await sessionCookie('user@test.com');

      const res = await request(app).post(`/api/forms/${formId}/clone`).set('Cookie', cookie);
      expect(res.status).toBe(201);
      expect(res.body.form.gtm_id).toBe(GTM);
    });

    it('a demoted admin\'s forms keep their container but it can no longer be changed', async () => {
      const userId = createUser('former-admin@test.com', 'user');
      const formId = createForm(userId);
      const cookie = await sessionCookie('former-admin@test.com');
      expect((await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ title: 'x', gtm_id: GTM })).status).toBe(200);
      expect((await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ gtm_id: 'GTM-NEW1' })).status).toBe(403);
      const visitor = await request(app).get('/api/public/form/gtm-form');
      expect(visitor.body.form.gtm_id).toBe(GTM);
    });

    it('API tokens still cannot write forms at all', async () => {
      const adminId = createUser('admin@test.com', 'admin');
      const formId = createForm(adminId);
      const { token } = apiTokens.createToken(adminId, 'ci');
      const res = await request(app).put(`/api/forms/${formId}`).set('Authorization', `Bearer ${token}`).send({ gtm_id: 'GTM-OTHER1' });
      expect(res.status).toBe(403);
      expect(storedGtm(formId)).toBe(GTM);
    });
  });
});
