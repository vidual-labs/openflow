const { looksLikeApiToken, findByToken, touchLastUsed } = require('../models/apiTokens');
const { SESSION_COOKIE, findSession } = require('../models/sessions');

// The session token comes from the httpOnly cookie, or — for API clients such
// as the lodgely connector, which logs in and replays the cookie value — from
// an `Authorization: Bearer` header. Read-only `ofw_` API tokens use the
// header too.
function readToken(req) {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function authMiddleware(req, res, next) {
  const token = readToken(req);
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

  // Server-side session (models/sessions.js). Logging out, a password or role
  // change, and an admin's "log out everywhere" delete the row, so a stolen
  // cookie stops working the moment any of those happen. Cookies from before
  // 0.44 (signed JWTs) match no row and simply ask for a fresh login.
  const session = findSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.userId = session.user_id;
  req.sessionId = session.id;
  req.authVia = 'session';
  next();
}

// Must run after authMiddleware (relies on req.userId). Rejects non-admins,
// and rejects API tokens outright: a token is a read-only integration
// credential (e.g. the lodgely connector), and must never inherit its owner's
// admin rights — otherwise an admin-minted token could download a full backup
// (password hashes, every submission) or list users.
function requireAdmin(req, res, next) {
  if (req.authVia === 'api_token') {
    return res.status(403).json({ error: 'API tokens cannot access admin endpoints' });
  }
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

module.exports = { authMiddleware, requireAdmin, requireSession, readToken };
