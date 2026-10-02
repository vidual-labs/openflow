// Regression tests for the bug-hunt fixes in 0.40.0.
jest.mock('../src/models/integrations', () => ({
  ...jest.requireActual('../src/models/integrations'),
  runIntegration: jest.fn(),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const { runIntegration } = require('../src/models/integrations');
const { enqueueAndAttempt, processDueDeliveries } = require('../src/models/deliveryQueue');
const { formatValue } = require('../src/utils/formatValue');
const { visibleSteps } = require('../src/utils/conditions');

function getDb() {
  return require('../src/models/db').getDb();
}

function seedUser(email = 'owner@test.com', role = 'admin') {
  const db = getDb();
  const userId = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, email, bcrypt.hashSync('ownerpass1234', 10), role);
  return userId;
}

function seedForm(userId, steps, slug = 'reg-form') {
  const db = getDb();
  const formId = uuid();
  db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
    .run(formId, userId, 'Regression form', slug, JSON.stringify(steps));
  return formId;
}

async function login(app, email = 'owner@test.com') {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'ownerpass1234' });
  return res.headers['set-cookie'];
}

describe('delivery queue retry scheduling', () => {
  it('stores next_attempt_at so the sweep finds it on the same day', async () => {
    const db = getDb();
    const userId = seedUser();
    const formId = seedForm(userId, [{ id: 'f1', type: 'text', label: 'Name' }]);
    db.prepare("INSERT INTO integrations (id, form_id, type, enabled, config) VALUES (?, ?, 'webhook', 1, '{}')")
      .run('int-1', formId);
    db.prepare("INSERT INTO submissions (id, form_id, data, metadata) VALUES (?, ?, ?, '{}')")
      .run('sub-1', formId, JSON.stringify({ f1: 'x' }));

    runIntegration.mockRejectedValueOnce(new Error('endpoint down'));
    await enqueueAndAttempt(db, formId, 'Regression form', 'sub-1', { f1: 'x' }, [], {});

    const row = db.prepare('SELECT * FROM integration_deliveries').get();
    expect(row.status).toBe('retrying');
    expect(row.attempts).toBe(1);
    // Same text format as datetime('now'), so byte-wise comparison works.
    expect(row.next_attempt_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const due = db.prepare("SELECT ? <= datetime('now', '+2 minutes') AS due").get(row.next_attempt_at);
    expect(due.due).toBe(1);

    // Once the retry time has passed, the sweep must pick it up.
    db.prepare("UPDATE integration_deliveries SET next_attempt_at = datetime('now', '-1 minute')").run();
    runIntegration.mockResolvedValueOnce(undefined);
    await processDueDeliveries(db);
    expect(db.prepare('SELECT status FROM integration_deliveries').get().status).toBe('success');
  });
});

describe('deleting rows with dependants', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('deletes a form that has delivery rows', async () => {
    const db = getDb();
    const userId = seedUser();
    const formId = seedForm(userId, [{ id: 'f1', type: 'text' }]);
    db.prepare("INSERT INTO integrations (id, form_id, type, enabled, config) VALUES ('int-1', ?, 'webhook', 1, '{}')").run(formId);
    db.prepare("INSERT INTO submissions (id, form_id, data, metadata) VALUES ('sub-1', ?, '{}', '{}')").run(formId);
    db.prepare("INSERT INTO integration_deliveries (id, form_id, integration_id, submission_id, type, status) VALUES ('d1', ?, 'int-1', 'sub-1', 'webhook', 'dead')").run(formId);

    const cookie = await login(app);
    const res = await request(app).delete(`/api/forms/${formId}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM integration_deliveries').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM forms').get().n).toBe(0);
  });

  it('deletes a user who owns forms and tokens, reassigning the forms to the admin', async () => {
    const db = getDb();
    const adminId = seedUser();
    const otherId = seedUser('other@test.com', 'user');
    const formId = seedForm(otherId, []);
    db.prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix) VALUES ('t1', ?, 'n', 'h', 'ofw_abc')").run(otherId);

    const cookie = await login(app);
    const res = await request(app).delete(`/api/auth/users/${otherId}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT user_id FROM forms WHERE id = ?').get(formId).user_id).toBe(adminId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(otherId).n).toBe(0);
  });

  it('refuses an admin changing their own role', async () => {
    const adminId = seedUser();
    const cookie = await login(app);
    const res = await request(app).put(`/api/auth/users/${adminId}`).set('Cookie', cookie).send({ role: 'user' });
    expect(res.status).toBe(400);
  });
});

describe('login input validation', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('returns 400 (not a 500 page) for non-string credentials', async () => {
    seedUser();
    for (const body of [{ email: {}, password: 'x' }, { email: 'owner@test.com', password: 123 }, { email: ['a'], password: ['b'] }]) {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    }
  });
});

describe('backup restore keeps the acting admin logged in', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('preserves token_version of the restoring admin', async () => {
    const db = getDb();
    const adminId = seedUser();
    db.prepare('UPDATE users SET token_version = 3 WHERE id = ?').run(adminId);
    const cookie = await login(app);
    const backup = await request(app).get('/api/admin/backup').set('Cookie', cookie);
    expect(backup.status).toBe(200);
    const restore = await request(app).post('/api/admin/restore').set('Cookie', cookie).send(backup.body);
    expect(restore.status).toBe(200);
    expect(db.prepare('SELECT token_version FROM users WHERE id = ?').get(adminId).token_version).toBe(3);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
  });

  it("keeps the restoring admin's two-factor login on and signs everyone else out", async () => {
    const db = getDb();
    const adminId = seedUser();
    const cookie = await login(app);
    const backup = await request(app).get('/api/admin/backup').set('Cookie', cookie);
    // 2FA switched on after the backup was taken: the restore must not undo it.
    db.prepare('UPDATE users SET twofa_enabled = 1 WHERE id = ?').run(adminId);
    db.prepare("INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES ('other', 'someone-else', 'h', 0, 0, ?)").run(Date.now() + 60000);

    const restore = await request(app).post('/api/admin/restore').set('Cookie', cookie).send(backup.body);
    expect(restore.status).toBe(200);
    expect(db.prepare('SELECT twofa_enabled FROM users WHERE id = ?').get(adminId).twofa_enabled).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = 'other'").get().n).toBe(0);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
  });
});

describe('submission validation', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('rejects a required address without street/postal/city', async () => {
    const userId = seedUser();
    seedForm(userId, [{ id: 'addr', type: 'address', label: 'Address', required: true }]);
    const bad = await request(app).post('/api/public/form/reg-form/submit').send({ data: { addr: {} } });
    expect(bad.status).toBe(400);
    const partial = await request(app).post('/api/public/form/reg-form/submit').send({ data: { addr: { street: 'Main St 1' } } });
    expect(partial.status).toBe(400);
    const ok = await request(app).post('/api/public/form/reg-form/submit')
      .send({ data: { addr: { street: 'Main St 1', postalCode: '12345', city: 'Berlin' } } });
    expect(ok.status).toBe(201);
  });

  it('rejects an empty multiple-choice answer for a required field', async () => {
    const userId = seedUser();
    seedForm(userId, [{ id: 'multi', type: 'multi-select', label: 'Pick', required: true }]);
    const res = await request(app).post('/api/public/form/reg-form/submit').send({ data: { multi: [] } });
    expect(res.status).toBe(400);
  });

  it('skips required steps hidden by conditional logic and drops their stale answers', async () => {
    const db = getDb();
    const userId = seedUser();
    seedForm(userId, [
      { id: 'q1', type: 'select', label: 'Type', options: ['a', 'b'], required: true },
      { id: 'q2', type: 'text', label: 'Only for a', required: true, condition: { field: 'q1', op: 'equals', value: 'a' } },
    ]);
    const hidden = await request(app).post('/api/public/form/reg-form/submit').send({ data: { q1: 'b', q2: 'stale answer' } });
    expect(hidden.status).toBe(201);
    const stored = JSON.parse(db.prepare('SELECT data FROM submissions').get().data);
    expect(stored).toEqual({ q1: 'b' });

    const shownButEmpty = await request(app).post('/api/public/form/reg-form/submit').send({ data: { q1: 'a' } });
    expect(shownButEmpty.status).toBe(400);
  });
});

describe('formatValue', () => {
  it('formats address and file answers as readable text', () => {
    expect(formatValue({ type: 'address' }, { street: 'Main St 1', postalCode: '12345', city: 'Berlin', country: 'DE' }))
      .toBe('Main St 1, 12345, Berlin, DE');
    expect(formatValue({ type: 'file-upload' }, { name: 'cv.pdf', type: 'application/pdf', size: 2048, data: 'data:application/pdf;base64,AAAA' }))
      .toBe('cv.pdf (2.0 KB)');
    expect(formatValue({ type: 'multi-select' }, ['a', 'b'])).toBe('a, b');
    expect(formatValue({ type: 'text' }, null)).toBe('');
  });
});

describe('CSV export', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('never prints [object Object] or base64 for address/file answers', async () => {
    const db = getDb();
    const userId = seedUser();
    const formId = seedForm(userId, [
      { id: 'addr', type: 'address', label: 'Address' },
      { id: 'file', type: 'file-upload', label: 'CV' },
    ]);
    db.prepare("INSERT INTO submissions (id, form_id, data, metadata) VALUES ('s1', ?, ?, '{}')").run(formId, JSON.stringify({
      addr: { street: 'Main St 1', postalCode: '12345', city: 'Berlin' },
      file: { name: 'cv.pdf', type: 'application/pdf', size: 10, data: 'data:application/pdf;base64,QUJD' },
    }));
    const cookie = await login(app);
    const res = await request(app).get(`/api/submissions/${formId}/export`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Main St 1, 12345, Berlin');
    expect(res.text).toContain('cv.pdf (10 B)');
    expect(res.text).not.toContain('[object Object]');
    expect(res.text).not.toContain('base64');
  });
});

describe('analytics', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('counts events from the first day of the window and groups drop-off by step id', async () => {
    const db = getDb();
    const userId = seedUser();
    const formId = seedForm(userId, [
      { id: 'a', type: 'text', label: 'A' },
      { id: 'b', type: 'text', label: 'B', condition: { field: 'a', op: 'equals', value: 'x' } },
      { id: 'c', type: 'text', label: 'C' },
    ]);
    const ins = db.prepare('INSERT INTO analytics_events (form_id, event, session_id, step_index, step_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    // Exactly 7 days ago, minus a bit — inside a 7-day window's first day.
    const oldDay = "datetime('now', '-6 days', '-23 hours')";
    db.prepare(`INSERT INTO analytics_events (form_id, event, session_id, created_at) VALUES (?, 'view', 's-old', ${oldDay})`).run(formId);
    ins.run(formId, 'view', 's1', null, null, new Date().toISOString().replace('T', ' ').slice(0, 19));
    // Session 1 saw A (index 0) then C (index 1, B hidden); session 2 saw A, B, C.
    const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
    ins.run(formId, 'step', 's1', 0, 'a', now());
    ins.run(formId, 'step', 's1', 1, 'c', now());
    ins.run(formId, 'step', 's2', 0, 'a', now());
    ins.run(formId, 'step', 's2', 1, 'b', now());
    ins.run(formId, 'step', 's2', 2, 'c', now());

    const cookie = await login(app);
    const res = await request(app).get(`/api/analytics/${formId}?days=7`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary.views).toBe(2);
    expect(res.body.stepDropoff.map(s => [s.label, s.sessions])).toEqual([['A', 2], ['B', 1], ['C', 2]]);
  });
});

describe('visibleSteps', () => {
  it('mirrors the renderer operators', () => {
    const steps = [
      { id: 'x' },
      { id: 'eq', condition: { field: 'x', op: 'equals', value: '1' } },
      { id: 'ne', condition: { field: 'x', op: 'not_equals', value: '1' } },
      { id: 'set', condition: { field: 'x', op: 'is_set' } },
      { id: 'unset', condition: { field: 'x', op: 'is_not_set' } },
      { id: 'has', condition: { field: 'x', op: 'contains', value: 'A' } },
    ];
    expect(visibleSteps(steps, {}).map(s => s.id)).toEqual(['x', 'eq', 'ne', 'set', 'unset', 'has']);
    expect(visibleSteps(steps, { x: '1' }).map(s => s.id)).toEqual(['x', 'eq', 'set']);
    expect(visibleSteps(steps, { x: 'bar' }).map(s => s.id)).toEqual(['x', 'ne', 'set', 'has']);
    expect(visibleSteps(steps, { x: '' }).map(s => s.id)).toEqual(['x', 'ne', 'unset']);
  });
});

describe('form payload validation', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('rejects non-array steps, non-object theme and a blank title', async () => {
    const userId = seedUser();
    const formId = seedForm(userId, []);
    const cookie = await login(app);
    for (const body of [{ steps: 'oops' }, { steps: {} }, { theme: 3 }, { end_screen: 'x' }, { title: '   ' }, { steps: [{ type: 'text' }] }]) {
      const res = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send(body);
      expect(res.status).toBe(400);
    }
    const ok = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({ steps: [{ id: 'a', type: 'text' }], title: 'Fine' });
    expect(ok.status).toBe(200);
    const create = await request(app).post('/api/forms').set('Cookie', cookie).send({ title: 'New', steps: 'nope' });
    expect(create.status).toBe(400);
  });

  it('the integration test endpoint survives a form whose steps are not an array', async () => {
    const db = getDb();
    const userId = seedUser();
    const formId = seedForm(userId, []);
    db.prepare("UPDATE forms SET steps = '\"oops\"' WHERE id = ?").run(formId);
    db.prepare("INSERT INTO integrations (id, form_id, type, enabled, config) VALUES ('int-1', ?, 'webhook', 1, '{}')").run(formId);
    const cookie = await login(app);
    const res = await request(app).post(`/api/integrations/${formId}/int-1/test`).set('Cookie', cookie);
    // Whatever the outcome, it is a JSON response — not a process exit.
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toBeDefined();
  });
});

describe('error responses are JSON', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('returns a JSON 400 for malformed JSON bodies', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ error: 'Invalid JSON body' });
  });
});

describe('login response', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('includes the role so the admin navigation shows without a reload', async () => {
    seedUser();
    const res = await request(app).post('/api/auth/login').send({ email: 'owner@test.com', password: 'ownerpass1234' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });
});

describe('typed field validation on submit', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('enforces number min/max, email and phone formats', async () => {
    const userId = seedUser();
    seedForm(userId, [
      { id: 'n', type: 'number', label: 'Guests', min: 1, max: 100 },
      { id: 'e', type: 'email', label: 'Email' },
      { id: 'p', type: 'phone', label: 'Phone' },
    ]);
    const post = (data) => request(app).post('/api/public/form/reg-form/submit').send({ data });
    expect((await post({ n: '500' })).status).toBe(400);
    expect((await post({ n: 'abc' })).status).toBe(400);
    expect((await post({ e: 'not-an-email' })).status).toBe(400);
    expect((await post({ p: 'abc' })).status).toBe(400);
    expect((await post({ n: '42', e: 'a@b.co', p: '+49 151 123456' })).status).toBe(201);
    expect((await post({ n: 0 })).status).toBe(400);
  });
});
