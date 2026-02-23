const request = require('supertest');
const { createTestApp } = require('./setup');

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
});
