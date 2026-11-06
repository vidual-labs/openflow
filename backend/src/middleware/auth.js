const { looksLikeApiToken, findByToken, touchLastUsed } = require('../models/apiTokens');
const { SESSION_COOKIE, findSession } = require('../models/sessions');

// "Sudo mode": how long a re-entered password (POST /api/auth/confirm-password)
// unlocks the actions behind requireRecentAuth, on that one session.
const REAUTH_WINDOW_MS = 10 * 60 * 1000;

function readSessionCookie(req) {
  const cookie = req.cookies?.[SESSION_COOKIE];
  return typeof cookie === 'string' && cookie ? cookie : null;
}

// The session token comes from the httpOnly cookie, or — for API clients such
// as the lodgely connector, which logs in and replays the cookie value — from
// an `Authorization: Bearer` header. Read-only `ofw_` API tokens use the
// header too.
function readToken(req) {
  const cookie = readSessionCookie(req);
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
  req.sessionReauthAt = session.reauth_at || null;
  req.authVia = 'session';
  next();
}

// The live session behind the browser's session cookie, or null. Only the
// cookie counts — a Bearer header is an API client, not a browser that is
// signed in. Used by the public form endpoint to keep a form's GTM container
// (third-party script on this origin) away from signed-in browsers.
function sessionFromCookie(req) {
  const token = readSessionCookie(req);
  if (!token || looksLikeApiToken(token)) return null;
  return findSession(token);
}

// The one role check. requireAdmin and the routes that treat admins
// differently (e.g. only admins may set a form's GTM container) both use it.
function isAdminUser(userId) {
  if (!userId) return false;
  const { getDb } = require('../models/db');
  const user = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId);
  return !!user && user.role === 'admin';
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
  if (!isAdminUser(req.userId)) {
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

// Must run after authMiddleware (and requireAdmin / requireSession where they
// apply). "Sudo mode" for the actions a script riding along with a signed-in
// browser must not be able to do with the session cookie alone: downloading
// or restoring a backup, creating/changing/deleting users and minting API
// tokens. They need the password re-entered on *this* session (POST
// /api/auth/confirm-password) within REAUTH_WINDOW_MS. A fresh login does not
// count, other sessions of the same account don't inherit it, and API tokens
// never pass.
function requireRecentAuth(req, res, next) {
  if (req.authVia !== 'session') {
    return res.status(403).json({ error: 'This action requires a logged-in session, not an API token' });
  }
  const at = Number(req.sessionReauthAt) || 0;
  const age = Date.now() - at;
  if (at > 0 && age >= 0 && age < REAUTH_WINDOW_MS) return next();
  return res.status(403).json({ error: 'Confirm your password to continue.', code: 'reauth_required' });
}

module.exports = {
  authMiddleware,
  requireAdmin,
  requireSession,
  requireRecentAuth,
  readToken,
  sessionFromCookie,
  isAdminUser,
  REAUTH_WINDOW_MS,
};
