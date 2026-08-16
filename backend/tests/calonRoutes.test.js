jest.mock('../src/models/calon');

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { createTestApp } = require('./setup');
const { fetchCalonAvailability } = require('../src/models/calon');

function getDb() {
  return require('../src/models/db').getDb();
}

async function seedUserAndLogin(app) {
  const db = getDb();
  const userId = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, 'owner@test.com', bcrypt.hashSync('ownerpass', 10), 'admin');
  const res = await request(app).post('/api/auth/login').send({ email: 'owner@test.com', password: 'ownerpass' });
  return { userId, cookie: res.headers['set-cookie'] };
}

function seedForm(userId, steps, published = 1) {
  const db = getDb();
  const formId = uuid();
  db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, ?)')
    .run(formId, userId, 'Booking Form', 'booking-form', JSON.stringify(steps), published);
  return formId;
}

describe('GET /api/public/form/:slug/availability', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });
  beforeEach(() => { fetchCalonAvailability.mockReset(); });

  it('404s for an unknown form slug', async () => {
    const res = await request(app).get('/api/public/form/does-not-exist/availability').query({ fieldId: 'x' });
    expect(res.status).toBe(404);
  });

  it('400s with no fieldId', async () => {
    const { userId } = await seedUserAndLogin(app);
    seedForm(userId, []);
    const res = await request(app).get('/api/public/form/booking-form/availability');
    expect(res.status).toBe(400);
  });

  it('404s when the field is not a calon-connected date-timeslot field', async () => {
    const { userId } = await seedUserAndLogin(app);
    seedForm(userId, [{ id: 'when', type: 'date-timeslot', calon: { enabled: false } }]);
    const res = await request(app).get('/api/public/form/booking-form/availability').query({ fieldId: 'when' });
    expect(res.status).toBe(404);
    expect(fetchCalonAvailability).not.toHaveBeenCalled();
  });

  it('404s for a calon-connected field that is not a date-timeslot type', async () => {
    const { userId } = await seedUserAndLogin(app);
    seedForm(userId, [{ id: 'when', type: 'text', calon: { enabled: true, baseUrl: 'https://calon.example.com' } }]);
    const res = await request(app).get('/api/public/form/booking-form/availability').query({ fieldId: 'when' });
    expect(res.status).toBe(404);
  });

  it('proxies calon slots for a connected field, passing its config through', async () => {
    const { userId } = await seedUserAndLogin(app);
    seedForm(userId, [{
      id: 'when', type: 'date-timeslot', durationMin: 30, rangeDays: 7,
      calon: { enabled: true, baseUrl: 'https://calon.example.com', resourceSlug: 'consulting' },
    }]);
    fetchCalonAvailability.mockResolvedValue({
      timezone: 'Europe/Berlin',
      slots: [{ start: '2026-09-02T09:00:00+02:00', end: '2026-09-02T09:30:00+02:00', timezone: 'Europe/Berlin' }],
    });

    const res = await request(app).get('/api/public/form/booking-form/availability').query({ fieldId: 'when' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      timezone: 'Europe/Berlin',
      slots: [{ start: '2026-09-02T09:00:00+02:00', end: '2026-09-02T09:30:00+02:00', timezone: 'Europe/Berlin' }],
    });
    expect(fetchCalonAvailability).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://calon.example.com',
      resourceSlug: 'consulting',
      durationMin: 30,
    }));
  });

  it('resolves a slug from slug_history so an old form link keeps working', async () => {
    const { userId } = await seedUserAndLogin(app);
    const formId = seedForm(userId, [{
      id: 'when', type: 'date-timeslot',
      calon: { enabled: true, baseUrl: 'https://calon.example.com', resourceSlug: 'default' },
    }]);
    getDb().prepare('UPDATE forms SET slug = ? WHERE id = ?').run('booking-form-v2', formId);
    getDb().prepare('INSERT INTO slug_history (old_slug, form_id) VALUES (?, ?)').run('booking-form', formId);
    fetchCalonAvailability.mockResolvedValue({ timezone: 'UTC', slots: [] });

    const res = await request(app).get('/api/public/form/booking-form/availability').query({ fieldId: 'when' });
    expect(res.status).toBe(200);
  });

  it('returns 502 when calon cannot be reached', async () => {
    const { userId } = await seedUserAndLogin(app);
    seedForm(userId, [{ id: 'when', type: 'date-timeslot', calon: { enabled: true, baseUrl: 'https://calon.example.com', resourceSlug: 'default' } }]);
    fetchCalonAvailability.mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/public/form/booking-form/availability').query({ fieldId: 'when' });
    expect(res.status).toBe(502);
  });
});

describe('POST /api/forms/:id/calon-test', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });
  beforeEach(() => { fetchCalonAvailability.mockReset(); });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/forms/some-id/calon-test').send({ baseUrl: 'https://calon.example.com' });
    expect(res.status).toBe(401);
  });

  it('404s for a form the user does not own', async () => {
    const { cookie } = await seedUserAndLogin(app);
    const res = await request(app)
      .post('/api/forms/does-not-exist/calon-test')
      .set('Cookie', cookie)
      .send({ baseUrl: 'https://calon.example.com' });
    expect(res.status).toBe(404);
  });

  it('400s with no baseUrl', async () => {
    const { userId, cookie } = await seedUserAndLogin(app);
    const formId = seedForm(userId, []);
    const res = await request(app).post(`/api/forms/${formId}/calon-test`).set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });

  it('reports success with the slot count and timezone', async () => {
    const { userId, cookie } = await seedUserAndLogin(app);
    const formId = seedForm(userId, []);
    fetchCalonAvailability.mockResolvedValue({ timezone: 'Europe/Berlin', slots: [{}, {}] });

    const res = await request(app)
      .post(`/api/forms/${formId}/calon-test`)
      .set('Cookie', cookie)
      .send({ baseUrl: 'https://calon.example.com', resourceSlug: 'default' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, timezone: 'Europe/Berlin', slotCount: 2 });
  });

  it('reports failure when calon cannot be reached', async () => {
    const { userId, cookie } = await seedUserAndLogin(app);
    const formId = seedForm(userId, []);
    fetchCalonAvailability.mockRejectedValue(new Error('This URL resolves to a private/internal address and cannot be used'));

    const res = await request(app)
      .post(`/api/forms/${formId}/calon-test`)
      .set('Cookie', cookie)
      .send({ baseUrl: 'http://169.254.169.254' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/private/);
  });
});
