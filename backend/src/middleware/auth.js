const jwt = require('jsonwebtoken');
const { looksLikeApiToken, findByToken, touchLastUsed } = require('../models/apiTokens');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using default insecure secret. Set JWT_SECRET in production!');
}

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
