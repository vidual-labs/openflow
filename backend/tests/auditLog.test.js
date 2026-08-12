const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { createTestApp } = require('./setup');

function getDb() {
  return require('../src/models/db').getDb();
}

function seedUsers() {
  const db = getDb();
  const adminId = uuid();
  const userId = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(adminId, 'admin@test.com', bcrypt.hashSync('adminpass', 10), 'admin');
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, 'user@test.com', bcrypt.hashSync('userpass', 10), 'user');
  return { adminId, userId };
}

async function login(app, email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.headers['set-cookie'];
}

describe('Audit log', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('authorization', () => {
    it('rejects unauthenticated access', async () => {
      const res = await request(app).get('/api/admin/audit-log');
      expect(res.status).toBe(401);
    });

    it('rejects non-admin users', async () => {
      seedUsers();
      const cookie = await login(app, 'user@test.com', 'userpass');
      const res = await request(app).get('/api/admin/audit-log').set('Cookie', cookie);
      expect(res.status).toBe(403);
    });
  });

  describe('recorded events', () => {
    it('records a failed login', async () => {
      seedUsers();
      await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'wrongpass' });

      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const res = await request(app).get('/api/admin/audit-log').set('Cookie', cookie);

      expect(res.status).toBe(200);
      const actions = res.body.events.map(e => e.action);
      expect(actions).toContain('login_failed');
      expect(actions).toContain('login_succeeded');
    });

    it('records user creation, role change and deletion', async () => {
      seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');

      const created = await request(app)
        .post('/api/auth/users')
        .set('Cookie', cookie)
        .send({ email: 'new@test.com', password: 'newuserpass1' });
      expect(created.status).toBe(201);

      await request(app)
        .put(`/api/auth/users/${created.body.user.id}`)
        .set('Cookie', cookie)
        .send({ role: 'admin' });

      await request(app)
        .delete(`/api/auth/users/${created.body.user.id}`)
        .set('Cookie', cookie);

      const res = await request(app).get('/api/admin/audit-log').set('Cookie', cookie);
      const actions = res.body.events.map(e => e.action);
      expect(actions).toContain('user_created');
      expect(actions).toContain('user_role_changed');
      expect(actions).toContain('user_deleted');
    });

    it('records a backup download', async () => {
      seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');
      await request(app).get('/api/admin/backup').set('Cookie', cookie);

      const res = await request(app).get('/api/admin/audit-log').set('Cookie', cookie);
      expect(res.body.events.map(e => e.action)).toContain('backup_downloaded');
    });
  });
});
