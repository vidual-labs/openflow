const request = require('supertest');
const { createTestApp } = require('./setup');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

describe('Authentication', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 if email is missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'password123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email and password required');
    });

    it('should return 400 if password is missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'user@test.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email and password required');
    });

    it('should return 401 for invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'user@test.com', password: 'wrongpassword' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should return 401 for non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'password123' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalidtoken');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid token');
    });
  });

  describe('User Management', () => {
    let adminCookie;
    let userCookie;
    let adminId;
    let userId;

    beforeAll(async () => {
      const db = require('../src/models/db').getDb();
      
      adminId = uuid();
      const adminHash = bcrypt.hashSync('adminpass', 10);
      db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(adminId, 'admin@test.com', adminHash, 'admin');
      
      userId = uuid();
      const userHash = bcrypt.hashSync('userpass', 10);
      db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(userId, 'user@test.com', userHash, 'user');

      const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'adminpass' });
      adminCookie = adminRes.headers['set-cookie'];

      const userRes = await request(app).post('/api/auth/login').send({ email: 'user@test.com', password: 'userpass' });
      userCookie = userRes.headers['set-cookie'];
    });

    describe('DELETE /api/auth/users/:id', () => {
      let testUserId;

      beforeEach(() => {
        const db = require('../src/models/db').getDb();
        testUserId = uuid();
        const hash = bcrypt.hashSync('testpass', 10);
        db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(testUserId, 'test@test.com', hash, 'user');
      });

      it('should allow authenticated user to delete another user', async () => {
        const res = await request(app)
          .delete(`/api/auth/users/${testUserId}`)
          .set('Cookie', userCookie);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        const db = require('../src/models/db').getDb();
        const deleted = db.prepare('SELECT id FROM users WHERE id = ?').get(testUserId);
        expect(deleted).toBeUndefined();
      });

      it('should allow admin to delete another user', async () => {
        const res = await request(app)
          .delete(`/api/auth/users/${testUserId}`)
          .set('Cookie', adminCookie);
        expect(res.status).toBe(200);
      });

      it('should return 400 when user tries to delete themselves', async () => {
        const res = await request(app)
          .delete(`/api/auth/users/${userId}`)
          .set('Cookie', userCookie);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Cannot delete yourself');
      });

      it('should return 404 for non-existent user', async () => {
        const res = await request(app)
          .delete('/api/auth/users/nonexistent')
          .set('Cookie', adminCookie);
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('User not found');
      });

      it('should return 401 without authentication', async () => {
        const res = await request(app).delete(`/api/auth/users/${testUserId}`);
        expect(res.status).toBe(401);
      });
    });
  });
});
