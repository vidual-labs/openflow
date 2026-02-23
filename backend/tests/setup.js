const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

jest.setTimeout(10000);

function setupTestDb() {
  const testDbPath = path.join(__dirname, '../data/test.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  
  process.env.DB_PATH = testDbPath;
  
  const { resetDb, initDb } = require('../src/models/db');
  resetDb();
  initDb();
  
  return require('../src/models/db').getDb();
}

beforeAll(() => {
  setupTestDb();
});

beforeEach(() => {
  const { getDb } = require('../src/models/db');
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  db.exec('DELETE FROM analytics_events');
  db.exec('DELETE FROM submissions');
  db.exec('DELETE FROM integrations');
  db.exec('DELETE FROM forms');
  db.exec('DELETE FROM users');
  db.pragma('foreign_keys = ON');
});

function createTestApp() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  const authRoutes = require('../src/routes/auth');
  const formRoutes = require('../src/routes/forms');
  const submissionRoutes = require('../src/routes/submissions');
  const publicRoutes = require('../src/routes/public');
  const integrationRoutes = require('../src/routes/integrations');
  const analyticsRoutes = require('../src/routes/analytics');

  app.use('/api/auth', authRoutes);
  app.use('/api/forms', formRoutes);
  app.use('/api/submissions', submissionRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use('/api/analytics', analyticsRoutes);

  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return app;
}

function getCookies(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return {};
  const cookies = {};
  setCookie.forEach(c => {
    const [name] = c.split('=');
    cookies[name] = c;
  });
  return cookies;
}

module.exports = { createTestApp, getCookies };
