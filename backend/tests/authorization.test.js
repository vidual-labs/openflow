const request = require('supertest');
const { createTestApp } = require('./setup');

describe('Authorization', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('GET /api/auth/users (admin only)', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/auth/users');
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/users')
        .set('Authorization', 'Bearer invalidtoken');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/forms', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/forms');
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/forms')
        .set('Authorization', 'Bearer invalidtoken');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/submissions/:formId', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/submissions/form-1');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/users', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/auth/users')
        .send({ email: 'new@test.com', password: 'newpass123' });
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .post('/api/auth/users')
        .set('Authorization', 'Bearer invalidtoken')
        .send({ email: 'new@test.com', password: 'newpass123' });
      expect(res.status).toBe(401);
    });
  });
});
