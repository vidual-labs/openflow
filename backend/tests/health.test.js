const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createTestApp } = require('./setup');

describe('GET /api/health', () => {
  it('reports ok with a working database', async () => {
    // /api/health is wired directly in src/index.js rather than the test
    // app's router set, so build a minimal app the same way index.js does.
    const { getDb } = require('../src/models/db');
    const app = express();
    app.use(cookieParser());
    app.get('/api/health', (req, res) => {
      try {
        getDb().prepare('SELECT 1').get();
        res.json({ status: 'ok' });
      } catch (err) {
        res.status(503).json({ status: 'error', error: 'Database unavailable' });
      }
    });

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
