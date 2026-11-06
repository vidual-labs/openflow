const request = require('supertest');
const { createTestApp } = require('./setup');

describe('Input Validation', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('Form submission validation', () => {
    it('should return 404 for non-existent form', async () => {
      const res = await request(app)
        .post('/api/public/form/nonexistent/submit')
        .send({ data: { field1: 'test' } });
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent form with missing data', async () => {
      const res = await request(app)
        .post('/api/public/form/nonexistent/submit');
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent form with invalid data', async () => {
      const res = await request(app)
        .post('/api/public/form/nonexistent/submit')
        .send({ data: 'not an object' });
      expect(res.status).toBe(404);
    });
  });

  describe('Analytics event validation', () => {
    // "accept valid event types" below submits against a real form id
    // (the route 404s on an unknown formId before validating the event),
    // so seed one after the global per-test wipe in setup.js.
    beforeEach(() => {
      const db = require('../src/models/db').getDb();
      db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run('validation-user', 'validation@test.com', 'x', 'user');
      db.prepare('INSERT INTO forms (id, user_id, title, slug, steps) VALUES (?, ?, ?, ?, ?)')
        .run('form-1', 'validation-user', 'Validation Test Form', 'validation-test-form', '[]');
    });

    it('should return 400 if formId is missing', async () => {
      const res = await request(app)
        .post('/api/public/track')
        .send({ event: 'view' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing formId or event');
    });

    it('should return 400 if event is missing', async () => {
      const res = await request(app)
        .post('/api/public/track')
        .send({ formId: 'form-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing formId or event');
    });

    it('should return 400 for invalid event type', async () => {
      const res = await request(app)
        .post('/api/public/track')
        .send({ formId: 'form-1', event: 'invalid_event' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid event type');
    });

    it('should accept valid event types', async () => {
      const validEvents = ['view', 'start', 'step', 'complete', 'drop'];
      for (const event of validEvents) {
        const res = await request(app)
          .post('/api/public/track')
          .send({ formId: 'form-1', event });
        expect(res.status).toBe(200);
      }
    });

    // A non-string formId reached the SQLite binding and answered 500.
    it.each([[{ a: 1 }], [['form-1']], [42]])('should return 400 for a non-string formId (%p)', async (formId) => {
      const res = await request(app)
        .post('/api/public/track')
        .send({ formId, event: 'view' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for a non-string event', async () => {
      const res = await request(app)
        .post('/api/public/track')
        .send({ formId: 'form-1', event: ['view'] });
      expect(res.status).toBe(400);
    });

    // Malformed optional parts used to make the insert throw, silently losing
    // the event; the event is kept with just the unusable part left out.
    it('should store the event when sessionId / stepIndex / stepId are malformed', async () => {
      const res = await request(app)
        .post('/api/public/track')
        .send({ formId: 'form-1', event: 'step', sessionId: { a: 1 }, stepIndex: 'x', stepId: ['s'] });
      expect(res.status).toBe(200);
      const db = require('../src/models/db').getDb();
      const row = db.prepare('SELECT session_id, step_index, step_id FROM analytics_events WHERE form_id = ?').get('form-1');
      expect(row).toEqual({ session_id: null, step_index: null, step_id: null });
    });

    it('should keep well-formed optional parts', async () => {
      await request(app)
        .post('/api/public/track')
        .send({ formId: 'form-1', event: 'step', sessionId: 'sess-1', stepIndex: 2, stepId: 'field_1' });
      const db = require('../src/models/db').getDb();
      const row = db.prepare('SELECT session_id, step_index, step_id FROM analytics_events WHERE form_id = ?').get('form-1');
      expect(row).toEqual({ session_id: 'sess-1', step_index: 2, step_id: 'field_1' });
    });
  });

  describe('Login validation', () => {
    it('should return 400 for empty email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: '', password: 'password' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for empty password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@test.com', password: '' });
      expect(res.status).toBe(400);
    });
  });
});
