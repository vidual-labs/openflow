const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { createTestApp } = require('./setup');
const { validateSlug } = require('../src/utils/slug');

describe('Slug validation (unit)', () => {
  it('accepts well-formed slugs', () => {
    expect(validateSlug('my-form').ok).toBe(true);
    expect(validateSlug('abc').ok).toBe(true);
    expect(validateSlug('spring-2026-launch').ok).toBe(true);
    expect(validateSlug('a1b2c3').ok).toBe(true);
  });

  it('rejects slugs shorter than the minimum', () => {
    expect(validateSlug('ab').ok).toBe(false);
  });

  it('rejects slugs longer than the maximum', () => {
    expect(validateSlug('a'.repeat(61)).ok).toBe(false);
  });

  it('rejects uppercase characters', () => {
    expect(validateSlug('MyForm').ok).toBe(false);
  });

  it('rejects leading and trailing hyphens', () => {
    expect(validateSlug('-leading').ok).toBe(false);
    expect(validateSlug('trailing-').ok).toBe(false);
  });

  it('rejects consecutive hyphens', () => {
    expect(validateSlug('foo--bar').ok).toBe(false);
  });

  it('rejects underscores and other special chars', () => {
    expect(validateSlug('foo_bar').ok).toBe(false);
    expect(validateSlug('foo bar').ok).toBe(false);
    expect(validateSlug('foo.bar').ok).toBe(false);
  });

  it('rejects reserved words', () => {
    expect(validateSlug('admin').ok).toBe(false);
    expect(validateSlug('api').ok).toBe(false);
    expect(validateSlug('login').ok).toBe(false);
    expect(validateSlug('embed').ok).toBe(false);
    expect(validateSlug('www').ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(validateSlug(123).ok).toBe(false);
    expect(validateSlug(null).ok).toBe(false);
    expect(validateSlug(undefined).ok).toBe(false);
  });
});

describe('Slug editing & history (integration)', () => {
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
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(userId, 'slug-tester@test.com', hash, 'user');

    const login = await request(app).post('/api/auth/login').send({ email: 'slug-tester@test.com', password: 'userpass' });
    cookie = login.headers['set-cookie'];

    const created = await request(app)
      .post('/api/forms')
      .set('Cookie', cookie)
      .send({ title: 'Test Form' });
    formId = created.body.form.id;
  });

  it('renames a form to a new slug', async () => {
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ slug: 'spring-launch' });
    expect(res.status).toBe(200);
    expect(res.body.form.slug).toBe('spring-launch');
  });

  it('archives the old slug in history when changed', async () => {
    const db = require('../src/models/db').getDb();
    const original = db.prepare('SELECT slug FROM forms WHERE id = ?').get(formId).slug;

    await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ slug: 'renamed-form' });

    const history = db.prepare('SELECT * FROM slug_history WHERE old_slug = ?').get(original);
    expect(history).toBeTruthy();
    expect(history.form_id).toBe(formId);
  });

  it('rejects invalid slugs with 400', async () => {
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ slug: 'INVALID' });
    expect(res.status).toBe(400);
  });

  it('rejects reserved slugs with 400', async () => {
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ slug: 'admin' });
    expect(res.status).toBe(400);
  });

  it('rejects a slug already taken by another form with 409', async () => {
    const other = await request(app)
      .post('/api/forms')
      .set('Cookie', cookie)
      .send({ title: 'Other Form' });
    await request(app)
      .put(`/api/forms/${other.body.form.id}`)
      .set('Cookie', cookie)
      .send({ slug: 'taken-slug' });

    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ slug: 'taken-slug' });
    expect(res.status).toBe(409);
  });

  it('rejects a slug that lives in another form\'s history with 409', async () => {
    const other = await request(app)
      .post('/api/forms')
      .set('Cookie', cookie)
      .send({ title: 'Other Form' });
    await request(app)
      .put(`/api/forms/${other.body.form.id}`)
      .set('Cookie', cookie)
      .send({ slug: 'first-name' });
    await request(app)
      .put(`/api/forms/${other.body.form.id}`)
      .set('Cookie', cookie)
      .send({ slug: 'second-name' });

    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ slug: 'first-name' });
    expect(res.status).toBe(409);
  });

  it('lets a form reclaim its own previous slug', async () => {
    await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ slug: 'alpha' });
    await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ slug: 'beta' });
    const res = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ slug: 'alpha' });
    expect(res.status).toBe(200);
    expect(res.body.form.slug).toBe('alpha');
  });

  it('accepts a no-op slug update (same slug)', async () => {
    const db = require('../src/models/db').getDb();
    const current = db.prepare('SELECT slug FROM forms WHERE id = ?').get(formId).slug;
    const res = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Cookie', cookie)
      .send({ slug: current });
    expect(res.status).toBe(200);

    const history = db.prepare('SELECT COUNT(*) as n FROM slug_history WHERE form_id = ?').get(formId);
    expect(history.n).toBe(0);
  });

  describe('public form lookup by old slug', () => {
    it('serves the form via its current canonical slug', async () => {
      await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ slug: 'current-slug', published: 1 });

      const res = await request(app).get('/api/public/form/current-slug');
      expect(res.status).toBe(200);
      expect(res.body.form.slug).toBe('current-slug');
    });

    it('serves the form when an old slug is requested, returning the canonical slug', async () => {
      const db = require('../src/models/db').getDb();
      const original = db.prepare('SELECT slug FROM forms WHERE id = ?').get(formId).slug;

      await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ slug: 'new-canonical', published: 1 });

      const res = await request(app).get(`/api/public/form/${original}`);
      expect(res.status).toBe(200);
      // Canonical slug is returned regardless of which alias was requested.
      expect(res.body.form.slug).toBe('new-canonical');
    });

    it('returns 404 when an old slug points to an unpublished form', async () => {
      const db = require('../src/models/db').getDb();
      const original = db.prepare('SELECT slug FROM forms WHERE id = ?').get(formId).slug;
      await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ slug: 'new-name' });
      // Form is still a draft (never published).
      const res = await request(app).get(`/api/public/form/${original}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for a slug that never existed', async () => {
      const res = await request(app).get('/api/public/form/nonexistent-slug');
      expect(res.status).toBe(404);
    });

    it('accepts submissions through an old slug after a rename', async () => {
      const db = require('../src/models/db').getDb();
      const original = db.prepare('SELECT slug FROM forms WHERE id = ?').get(formId).slug;

      await request(app)
        .put(`/api/forms/${formId}`)
        .set('Cookie', cookie)
        .send({
          slug: 'fresh-slug',
          published: 1,
          steps: [{ id: 'name', label: 'Name', type: 'text', required: false }],
        });

      const res = await request(app)
        .post(`/api/public/form/${original}/submit`)
        .send({ data: { name: 'Alice' } });
      expect(res.status).toBe(201);
    });
  });
});
