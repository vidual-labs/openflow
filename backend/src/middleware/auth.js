const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { looksLikeApiToken, findByToken, touchLastUsed } = require('../models/apiTokens');

// If JWT_SECRET isn't provided via env, generate a random one and persist it
// next to the database (same volume as DB_PATH) so it survives restarts.
// This avoids ever falling back to a hardcoded, publicly-known secret, which
// would let anyone forge admin session tokens.
function loadOrCreateJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  const dataDir = path.dirname(process.env.DB_PATH || path.join(__dirname, '../../data/openflow.db'));
  const secretPath = path.join(dataDir, '.jwt_secret');

  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) return existing;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
    console.warn('WARNING: JWT_SECRET is not set. Generated and persisted a random secret at ' + secretPath + '. Set JWT_SECRET explicitly in production to control this.');
    return generated;
  } catch (err) {
    // Can't persist (e.g. read-only filesystem) — fall back to an
    // in-memory random secret. Sessions won't survive a restart, but at
    // least no hardcoded/guessable secret is ever used.
    console.warn('WARNING: JWT_SECRET is not set and could not be persisted (' + err.message + '). Using an ephemeral random secret; all sessions will be invalidated on restart.');
    return crypto.randomBytes(48).toString('hex');
  }
}

const JWT_SECRET = loadOrCreateJwtSecret();

function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Long-lived API tokens (e.g. the lodgely connector). These are read-only:
  // they authenticate the owning user but may only perform safe (GET/HEAD)
  // requests — anything that mutates state is rejected.
  if (looksLikeApiToken(token)) {
    const row = findByToken(token);
    if (!row) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(403).json({ error: 'API tokens are read-only' });
    }
    req.userId = row.user_id;
    req.authVia = 'api_token';
    touchLastUsed(row.id);
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.authVia = 'session';
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

// Must run after authMiddleware (relies on req.userId). Rejects non-admins.
function requireAdmin(req, res, next) {
  const { getDb } = require('../models/db');
  const db = getDb();
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Must run after authMiddleware. Rejects requests authenticated by an API
// token, so that token-management endpoints (and anything else that should
// require a real login) can never be driven by a token itself.
function requireSession(req, res, next) {
  if (req.authVia === 'api_token') {
    return res.status(403).json({ error: 'This action requires a logged-in session, not an API token' });
  }
  next();
}

module.exports = { authMiddleware, signToken, requireAdmin, requireSession };
