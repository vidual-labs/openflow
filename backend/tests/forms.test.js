const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { createTestApp } = require('./setup');

function getDb() {
  return require('../src/models/db').getDb();
}

function seedUser() {
  const db = getDb();
  const userId = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, 'owner@test.com', bcrypt.hashSync('ownerpass', 10), 'admin');
  return userId;
}

async function login(app) {
  const res = await request(app).post('/api/auth/login').send({ email: 'owner@test.com', password: 'ownerpass' });
  return res.headers['set-cookie'];
}

describe('Form clone', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/forms/some-id/clone');
    expect(res.status).toBe(401);
  });

  it('returns 404 when cloning a form the user does not own', async () => {
    seedUser();
    const cookie = await login(app);
    const res = await request(app).post('/api/forms/does-not-exist/clone').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('clones structure as a draft with a new slug and a "(Copy)" title', async () => {
    const userId = seedUser();
    const db = getDb();
    const formId = uuid();
    const steps = [{ id: 'name', type: 'text', label: 'Name', question: 'Your name?' }];
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
      .run(formId, userId, 'Lead Form', 'lead-form', JSON.stringify(steps));
    // A submission on the original must NOT carry over to the clone.
    db.prepare('INSERT INTO submissions (id, form_id, data) VALUES (?, ?, ?)')
      .run(uuid(), formId, JSON.stringify({ name: 'Ada' }));

    const cookie = await login(app);
    const res = await request(app).post(`/api/forms/${formId}/clone`).set('Cookie', cookie);

    expect(res.status).toBe(201);
    const clone = res.body.form;
    expect(clone.id).not.toBe(formId);
    expect(clone.slug).not.toBe('lead-form');
    expect(clone.title).toBe('Lead Form (Copy)');
    expect(clone.published).toBe(0);
    expect(clone.steps).toEqual(steps);
    expect(clone.submission_count).toBe(0);

    const cloneSubs = db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE form_id = ?').get(clone.id);
    expect(cloneSubs.n).toBe(0);
  });

  it('copies integrations but creates them disabled', async () => {
    const userId = seedUser();
    const db = getDb();
    const formId = uuid();
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps) VALUES (?, ?, ?, ?, ?)')
      .run(formId, userId, 'With Integrations', 'with-integrations', '[]');
    db.prepare('INSERT INTO integrations (id, form_id, type, enabled, config) VALUES (?, ?, ?, 1, ?)')
      .run(uuid(), formId, 'webhook', JSON.stringify({ url: 'https://example.com/hook' }));

    const cookie = await login(app);
    const res = await request(app).post(`/api/forms/${formId}/clone`).set('Cookie', cookie);
    expect(res.status).toBe(201);

    const cloned = db.prepare('SELECT type, enabled, config FROM integrations WHERE form_id = ?').all(res.body.form.id);
    expect(cloned).toHaveLength(1);
    expect(cloned[0].type).toBe('webhook');
    expect(cloned[0].enabled).toBe(0);
    expect(JSON.parse(cloned[0].config).url).toBe('https://example.com/hook');
  });
});

describe('Combined "group" steps', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  function seedGroupForm() {
    const db = getDb();
    const userId = uuid();
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(userId, 'g@test.com', bcrypt.hashSync('x', 10), 'admin');
    const formId = uuid();
    const steps = [
      {
        id: 'group_1', type: 'group', fields: [
          { id: 'email', type: 'email', label: 'Email', required: true },
          { id: 'phone', type: 'phone', label: 'Phone', required: true },
        ],
      },
    ];
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
      .run(formId, userId, 'Combined', 'combined', JSON.stringify(steps));
    return { formId };
  }

  it('validates every field inside a combined step on submit', async () => {
    seedGroupForm();
    const res = await request(app)
      .post('/api/public/form/combined/submit')
      .send({ data: { email: 'a@b.com' } }); // phone missing
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Phone/);
  });

  it('accepts a submission that fills every field in the combined step', async () => {
    seedGroupForm();
    const res = await request(app)
      .post('/api/public/form/combined/submit')
      .send({ data: { email: 'a@b.com', phone: '+1 555' } });
    expect(res.status).toBe(201);
  });
});
