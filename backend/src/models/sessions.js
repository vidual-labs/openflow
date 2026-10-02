const crypto = require('crypto');
const { getDb } = require('./db');

// Server-side login sessions and "remembered" browsers.
//
// The browser only ever holds a random 256-bit token; the DB stores its
// SHA-256, so neither a leaked database nor a backup can be replayed as a
// login. Because the session lives in the DB, logging out, changing a
// password or an admin's "log out everywhere" end it immediately — unlike the
// stateless JWT this replaced, which stayed valid until it expired.

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 7 * DAY_MS;
const DEVICE_TTL_MS = 30 * DAY_MS;
// last_seen_at is informational ("active sessions" list); writing it on every
// request would turn every page load into a DB write.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const SESSION_COOKIE = 'token';

// One remembered-browser cookie per account, so a browser shared by two
// accounts (an admin with a second test login) remembers both. The name is
// derived from the user id but doesn't reveal it.
function deviceCookieName(userId) {
  return 'of_dev_' + crypto.createHash('sha256').update('openflow-device:' + userId).digest('hex').slice(0, 16);
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

function userAgent(req) {
  const ua = req.headers?.['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 300) : null;
}

// --- Sessions ---

function createSession(userId, req) {
  const token = newToken();
  const now = Date.now();
  const id = crypto.randomUUID();
  getDb().prepare(
    'INSERT INTO sessions (id, user_id, token_hash, ip, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, hashToken(token), clientIp(req), userAgent(req), now, now, now + SESSION_TTL_MS);
  return { id, token, expiresAt: now + SESSION_TTL_MS };
}

// Returns the live session for a raw token, or null. Expired rows are treated
// as missing (and swept by cleanupExpired()).
function findSession(token) {
  if (!token || typeof token !== 'string') return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= now) return null;
  if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, row.id);
  }
  return row;
}

function deleteSessionByToken(token) {
  if (!token || typeof token !== 'string') return;
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function deleteSession(userId, sessionId) {
  return getDb().prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId).changes > 0;
}

function listSessions(userId) {
  return getDb().prepare(
    'SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC'
  ).all(userId, Date.now());
}

// Ends every session of the user (optionally except one, e.g. the browser
// that just changed the password) and, with `devices`, forgets every
// remembered browser too so the next login needs the e-mailed code again.
function revokeUserSessions(userId, { exceptSessionId = null, devices = false } = {}) {
  const db = getDb();
  if (exceptSessionId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
  if (devices) db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(userId);
  // A login code e-mailed before the change must not complete a login after it.
  db.prepare('DELETE FROM auth_challenges WHERE user_id = ?').run(userId);
}

// --- Remembered browsers ---

// The device row matching this cookie for this user, or null.
function findDevice(token, userId) {
  if (!token || typeof token !== 'string' || !userId) return null;
  const row = getDb().prepare('SELECT * FROM trusted_devices WHERE token_hash = ? AND user_id = ?').get(hashToken(token), userId);
  if (!row || row.expires_at <= Date.now()) return null;
  return row;
}

// Remembers this browser for the user after a successful login. Reuses the
// browser's existing device row when its cookie is still valid and slides its
// expiry. `trusted2fa` upgrades it to skip the e-mailed code; it is never
// downgraded here. Returns the raw token to (re)set as the cookie.
function rememberDevice(userId, req, { existingToken = null, trusted2fa = false } = {}) {
  const db = getDb();
  const now = Date.now();
  const existing = findDevice(existingToken, userId);
  if (existing) {
    db.prepare(
      'UPDATE trusted_devices SET last_used_at = ?, expires_at = ?, ip = ?, user_agent = ?, trusted_2fa = MAX(trusted_2fa, ?) WHERE id = ?'
    ).run(now, now + DEVICE_TTL_MS, clientIp(req), userAgent(req), trusted2fa ? 1 : 0, existing.id);
    return existingToken;
  }
  const token = newToken();
  db.prepare(
    'INSERT INTO trusted_devices (id, user_id, token_hash, trusted_2fa, ip, user_agent, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, hashToken(token), trusted2fa ? 1 : 0, clientIp(req), userAgent(req), now, now, now + DEVICE_TTL_MS);
  return token;
}

function listDevices(userId) {
  return getDb().prepare(
    'SELECT id, trusted_2fa, ip, user_agent, created_at, last_used_at, expires_at FROM trusted_devices WHERE user_id = ? AND expires_at > ? ORDER BY last_used_at DESC'
  ).all(userId, Date.now());
}

function deleteDevice(userId, deviceId) {
  return getDb().prepare('DELETE FROM trusted_devices WHERE id = ? AND user_id = ?').run(deviceId, userId).changes > 0;
}

// Drops the "skip the code" trust from every remembered browser of the user
// (e.g. when 2FA is switched on, so browsers remembered before it existed
// don't get to skip it), optionally keeping one.
function untrustDevices(userId, { exceptDeviceId = null } = {}) {
  getDb().prepare('UPDATE trusted_devices SET trusted_2fa = 0 WHERE user_id = ? AND id != ?').run(userId, exceptDeviceId || '');
}

// Everything tied to a user, for when the account is deleted.
function deleteAllForUser(userId) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM auth_challenges WHERE user_id = ?').run(userId);
}

function cleanupExpired(db = getDb()) {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM trusted_devices WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(now - DAY_MS);
  db.prepare('DELETE FROM login_failures WHERE last_failure_at <= ? AND locked_until <= ?').run(now - DAY_MS, now);
}

let cleanupTimer = null;
function startSessionCleanup(db) {
  cleanupExpired(db);
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    try { cleanupExpired(db); } catch { /* next run retries */ }
  }, 60 * 60 * 1000);
  cleanupTimer.unref();
}

// Cookie options. `secure` follows NODE_ENV like before (docker-compose sets
// production); the device cookie is only ever needed by /api/auth, so it is
// scoped there and never travels with any other request.
function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

function deviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: DEVICE_TTL_MS,
  };
}

module.exports = {
  SESSION_COOKIE,
  deviceCookieName,
  SESSION_TTL_MS,
  DEVICE_TTL_MS,
  hashToken,
  createSession,
  findSession,
  deleteSessionByToken,
  deleteSession,
  listSessions,
  revokeUserSessions,
  findDevice,
  rememberDevice,
  listDevices,
  deleteDevice,
  untrustDevices,
  deleteAllForUser,
  cleanupExpired,
  startSessionCleanup,
  sessionCookieOptions,
  deviceCookieOptions,
};
