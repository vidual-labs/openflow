const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');

function getDb() {
  return require('../src/models/db').getDb();
}

function seedUser(email = 'owner@test.com') {
  const userId = uuid();
  getDb().prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, email, bcrypt.hashSync('ownerpass1234', 10), 'user');
  return userId;
}

function seedForm(userId, steps, slug = 'an-form') {
  const formId = uuid();
  getDb().prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
    .run(formId, userId, 'Analytics form', slug, JSON.stringify(steps));
  return formId;
}

async function login(app, email = 'owner@test.com') {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'ownerpass1234' });
  return res.headers['set-cookie'];
}

function track(formId, session, event, at, stepIndex = null, stepId = null) {
  getDb().prepare('INSERT INTO analytics_events (form_id, event, session_id, step_index, step_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(formId, event, session, stepIndex, stepId, at);
}

const STEPS = [
  { id: 'a', type: 'text', label: 'Name' },
  { id: 'b', type: 'email', label: 'Email' },
  { id: 'c', type: 'phone', label: 'Phone' },
];

describe('form analytics', () => {
  let app;
  let cookie;
  let formId;
  beforeAll(() => { app = createTestApp(); });
  beforeEach(async () => {
    formId = seedForm(seedUser(), STEPS);
    cookie = await login(app);
  });

  it('reports reach, drop-off and median time per step for a date range', async () => {
    // s1 completes: 10s on a, 20s on b, 30s on c.
    track(formId, 's1', 'view', '2026-03-02 10:00:00');
    track(formId, 's1', 'step', '2026-03-02 10:00:00', 0, 'a');
    track(formId, 's1', 'start', '2026-03-02 10:00:05');
    track(formId, 's1', 'step', '2026-03-02 10:00:10', 1, 'b');
    track(formId, 's1', 'step', '2026-03-02 10:00:30', 2, 'c');
    track(formId, 's1', 'complete', '2026-03-02 10:01:00');
    // s2 leaves on b after 4s on a.
    track(formId, 's2', 'view', '2026-03-03 09:00:00');
    track(formId, 's2', 'step', '2026-03-03 09:00:00', 0, 'a');
    track(formId, 's2', 'step', '2026-03-03 09:00:04', 1, 'b');
    // s3 bounces on a.
    track(formId, 's3', 'view', '2026-03-04 09:00:00');
    track(formId, 's3', 'step', '2026-03-04 09:00:00', 0, 'a');
    // Outside the range.
    track(formId, 's4', 'step', '2026-03-10 09:00:00', 0, 'a');

    const res = await request(app)
      .get(`/api/analytics/${formId}?from=2026-03-01&to=2026-03-07`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.range).toEqual({ from: '2026-03-01', to: '2026-03-07', days: 7 });
    expect(res.body.summary).toMatchObject({ views: 3, starts: 1, completions: 1, entered: 3, conversionRate: 33.3 });
    expect(res.body.compare).toBeNull();
    const byId = Object.fromEntries(res.body.stepDropoff.map(s => [s.stepId, s]));
    expect(res.body.stepDropoff.map(s => s.stepId)).toEqual(['a', 'b', 'c']);
    expect(byId.a).toMatchObject({ sessions: 3, reachRate: 100, dropped: 1, dropRate: 33.3, medianSeconds: 7 });
    expect(byId.b).toMatchObject({ sessions: 2, reachRate: 66.7, dropped: 1, dropRate: 50, medianSeconds: 20 });
    expect(byId.c).toMatchObject({ sessions: 1, dropped: 0, medianSeconds: 30 });
  });

  it('counts the step a session left on, even after going back', async () => {
    track(formId, 's1', 'step', '2026-03-02 10:00:00', 0, 'a');
    track(formId, 's1', 'step', '2026-03-02 10:00:10', 1, 'b');
    track(formId, 's1', 'step', '2026-03-02 10:00:15', 0, 'a');
    track(formId, 's1', 'step', '2026-03-02 10:00:15', 0, 'a'); // re-render

    const res = await request(app).get(`/api/analytics/${formId}?from=2026-03-02&to=2026-03-02`).set('Cookie', cookie);
    const byId = Object.fromEntries(res.body.stepDropoff.map(s => [s.stepId, s]));
    expect(byId.a).toMatchObject({ sessions: 1, dropped: 1 });
    expect(byId.b).toMatchObject({ sessions: 1, dropped: 0, medianSeconds: 5 });
  });

  it('returns a comparison period with steps that only existed then', async () => {
    track(formId, 'old', 'step', '2026-02-01 10:00:00', 0, 'a');
    track(formId, 'old', 'step', '2026-02-01 10:00:05', 1, 'gone');
    track(formId, 'new', 'step', '2026-03-01 10:00:00', 0, 'a');

    const res = await request(app)
      .get(`/api/analytics/${formId}?from=2026-03-01&to=2026-03-31&compareFrom=2026-02-01&compareTo=2026-02-28`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.compare.range).toEqual({ from: '2026-02-01', to: '2026-02-28', days: 28 });
    const gone = res.body.compare.stepDropoff.find(s => s.stepId === 'gone');
    expect(gone).toMatchObject({ removed: true, label: 'Removed step (was #2)', dropped: 1 });
    expect(res.body.stepDropoff.map(s => s.stepId)).toEqual(['a']);
  });

  it('rejects malformed or inverted ranges', async () => {
    for (const q of ['from=2026-3-1&to=2026-03-02', 'from=2026-03-05&to=2026-03-01', 'from=2026-02-30&to=2026-03-01', 'from=2024-01-01&to=2026-01-01']) {
      const res = await request(app).get(`/api/analytics/${formId}?${q}`).set('Cookie', cookie);
      expect(res.status).toBe(400);
    }
    const res = await request(app).get(`/api/analytics/${formId}?from=2026-03-01&to=2026-03-02&compareFrom=x`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('includes the previous period in the overview', async () => {
    const at = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    track(formId, 'now1', 'view', at(1));
    track(formId, 'now1', 'complete', at(1));
    track(formId, 'now2', 'view', at(2));
    track(formId, 'prev', 'view', at(10));

    const res = await request(app).get('/api/analytics/overview?days=7').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.forms[0]).toMatchObject({ views: 2, completions: 1, conversionRate: 50, published: true });
    expect(res.body.forms[0].previous).toMatchObject({ views: 1, completions: 0 });
  });

  it('does not show another user\'s form', async () => {
    const otherForm = seedForm(seedUser('other@test.com'), STEPS, 'other-form');
    const res = await request(app).get(`/api/analytics/${otherForm}?days=7`).set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
