const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { createTestApp } = require('./setup');

function getDb() {
  return require('../src/models/db').getDb();
}

describe('Session revocation', () => {
  let app;
  let adminCookie;
  let targetId;
  let targetCookie;

  beforeAll(() => { app = createTestApp(); });

  beforeEach(async () => {
    const db = getDb();
    const adminId = uuid();
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(adminId, 'revoke-admin@test.com', bcrypt.hashSync('adminpass', 10), 'admin');
    targetId = uuid();
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(targetId, 'revoke-target@test.com', bcrypt.hashSync('targetpass', 10), 'user');

    const adminRes = await request(app).post('/api/auth/login').send({ email: 'revoke-admin@test.com', password: 'adminpass' });
    adminCookie = adminRes.headers['set-cookie'];

    const targetRes = await request(app).post('/api/auth/login').send({ email: 'revoke-target@test.com', password: 'targetpass' });
    targetCookie = targetRes.headers['set-cookie'];
  });

  it('rejects a session token after an admin forces logout-everywhere', async () => {
    const before = await request(app).get('/api/auth/me').set('Cookie', targetCookie);
    expect(before.status).toBe(200);

    const revokeRes = await request(app)
      .post(`/api/auth/users/${targetId}/revoke-sessions`)
      .set('Cookie', adminCookie);
    expect(revokeRes.status).toBe(200);

    const after = await request(app).get('/api/auth/me').set('Cookie', targetCookie);
    expect(after.status).toBe(401);
  });

  it('rejects an old session token after the password is changed', async () => {
    await request(app)
      .put(`/api/auth/users/${targetId}`)
      .set('Cookie', adminCookie)
      .send({ password: 'brandnewpassword' });

    const res = await request(app).get('/api/auth/me').set('Cookie', targetCookie);
    expect(res.status).toBe(401);
  });

  it('rejects an old session token after a role change', async () => {
    await request(app)
      .put(`/api/auth/users/${targetId}`)
      .set('Cookie', adminCookie)
      .send({ role: 'admin' });

    const res = await request(app).get('/api/auth/me').set('Cookie', targetCookie);
    expect(res.status).toBe(401);
  });

  it('lets the user log in again after revocation and use the new session', async () => {
    await request(app).post(`/api/auth/users/${targetId}/revoke-sessions`).set('Cookie', adminCookie);

    const reLogin = await request(app).post('/api/auth/login').send({ email: 'revoke-target@test.com', password: 'targetpass' });
    const freshCookie = reLogin.headers['set-cookie'];

    const res = await request(app).get('/api/auth/me').set('Cookie', freshCookie);
    expect(res.status).toBe(200);
  });
});
