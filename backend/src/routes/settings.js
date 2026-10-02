const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { logAuditEvent } = require('../models/auditLog');

const router = Router();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const ALLOWED_KEYS = ['branding'];

// OPENFLOW_LANDING_PAGE=true shows the marketing landing page at `/` to
// logged-out visitors (login moves to /login). Off by default, so an install
// keeps opening straight on the login screen unless the operator opts in.
function isLandingPageEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.OPENFLOW_LANDING_PAGE || '').trim().toLowerCase());
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

// GET /api/settings — public, so it returns only the publicly editable keys.
// Other rows of site_settings (e.g. `smtp`, the encrypted system-mail
// settings) are private and must never be listed here.
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM site_settings WHERE key IN (${ALLOWED_KEYS.map(() => '?').join(', ')})`).all(...ALLOWED_KEYS);
  const settings = {};
  for (const row of rows) {
    settings[row.key] = JSON.parse(row.value);
  }
  // Expose the operator-configured primary host so the form editor can render
  // a correct subdomain preview ("<your-subdomain>.openflow.example.com").
  const primaryHost = process.env.OPENFLOW_PRIMARY_HOST || null;
  res.json({ settings, primaryHost, landingPage: isLandingPageEnabled() });
});

// PUT /api/settings/:key — admin only
router.put('/:key', authMiddleware, requireAdmin, (req, res) => {
  const db = getDb();

  const { key } = req.params;
  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Unknown settings key' });
  }

  const value = req.body;
  db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));

  logAuditEvent({ userId: req.userId, action: 'settings_updated', target: key, ip: clientIp(req) });
  res.json({ ok: true, [key]: value });
});

module.exports = router;
