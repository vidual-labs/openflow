const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../models/db');
const { authMiddleware, signToken, requireSession, requireAdmin } = require('../middleware/auth');
const apiTokens = require('../models/apiTokens');
const { checkRateLimit, isRateLimited } = require('../models/rateLimit');
const { logAuditEvent } = require('../models/auditLog');
const logger = require('../utils/logger');
const { isWeakPassword, flagWeakPassword, hasWeakPassword } = require('../models/secureDefaults');

const router = Router();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  // Non-string values would throw inside the SQLite binding / bcrypt and
  // surface as an HTML 500 page, bypassing the failed-login counter.
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Throttle by IP and by targeted email so neither a single-source
  // credential-stuffing run nor a distributed brute-force of one account
  // can guess passwords unthrottled. Only failed attempts consume the
  // budget (checked below), so legitimate repeated logins are never
  // penalized — this only gates callers who are already over the limit.
  const ipKey = `login-ip:${clientIp(req)}`;
  const emailKey = `login-email:${String(email).toLowerCase()}`;
  if (isRateLimited(ipKey, 20) || isRateLimited(emailKey, 10)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Always run a bcrypt compare, even for an unknown email, so response
  // timing doesn't reveal whether an account exists.
  const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : '$2a$10$invalidsaltinvalidsaltinvalidsalu');
  if (!user || !passwordOk) {
    checkRateLimit(ipKey, 20, 60);
    checkRateLimit(emailKey, 10, 60);
    logAuditEvent({ action: 'login_failed', target: String(email).toLowerCase(), ip: clientIp(req) });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  logAuditEvent({ userId: user.id, action: 'login_succeeded', target: user.email, ip: clientIp(req) });
  // The plaintext is only ever at hand here, so this is where a weak or
  // well-known password (e.g. a pre-0.16 `admin123`) gets noticed; the admin
  // UI shows a "change your password" banner while the flag is set.
  flagWeakPassword(user.id, isWeakPassword(password));
  const token = signToken(user.id, user.token_version || 0);
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ user: { id: user.id, email: user.email, role: user.role, created_at: user.created_at, weakPassword: hasWeakPassword(user.id) } });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, weakPassword: hasWeakPassword(user.id) } });
});

// --- Multi-user management (admin only) ---

// List all users
router.get('/users', authMiddleware, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, email, role, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ users });
});

// Create / invite user
router.post('/users', authMiddleware, requireAdmin, (req, res) => {
  if (!checkRateLimit(`users-create:${req.userId}`, 20, 60)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  if (isWeakPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 10 characters and not a well-known default' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  const { randomUUID: uuid } = require('crypto');
  const hash = bcrypt.hashSync(password, 10);
  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    id, email, hash, role === 'admin' ? 'admin' : 'user'
  );

  logAuditEvent({ userId: req.userId, action: 'user_created', target: email, ip: clientIp(req), details: { role: role === 'admin' ? 'admin' : 'user' } });
  res.status(201).json({ user: { id, email, role: role === 'admin' ? 'admin' : 'user' } });
});

// Update user role
router.put('/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { role, password } = req.body;
  if (role) {
    // An admin demoting themselves would lock the last admin out (the role
    // change also revokes their session); make that a deliberate act by
    // another admin instead.
    if (req.params.id === req.userId && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }
    db.prepare('UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?').run(role === 'admin' ? 'admin' : 'user', req.params.id);
    logAuditEvent({ userId: req.userId, action: 'user_role_changed', target: user.email, ip: clientIp(req), details: { role: role === 'admin' ? 'admin' : 'user' } });
  }
  if (password) {
    if (isWeakPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 10 characters and not a well-known default' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, req.params.id);
    flagWeakPassword(req.params.id, false);
    logAuditEvent({ userId: req.userId, action: 'user_password_changed', target: user.email, ip: clientIp(req) });
  }

  const updated = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?').get(req.params.id);
  res.json({ user: updated });
});

// Force-expire a user's existing sessions (any JWT already issued to them)
// without touching their password — e.g. after a suspected compromise or
// before a role change takes visible effect. Takes effect on their very
// next request via the token_version check in authMiddleware.
router.post('/users/:id/revoke-sessions', authMiddleware, requireAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.params.id);
  logAuditEvent({ userId: req.userId, action: 'user_sessions_revoked', target: user.email, ip: clientIp(req) });
  res.json({ ok: true });
});

// Delete user (admin only)
router.delete('/users/:id', authMiddleware, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    if (req.params.id === req.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    const targetUser = db.prepare('SELECT email, role FROM users WHERE id = ?').get(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    // forms.user_id and api_tokens.user_id reference users(id): hand the
    // user's forms (and their leads) to the deleting admin instead of
    // failing the FK check, and revoke their API tokens.
    const reassigned = db.transaction((userId, newOwnerId) => {
      const { changes } = db.prepare('UPDATE forms SET user_id = ? WHERE user_id = ?').run(newOwnerId, userId);
      db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      return changes;
    })(req.params.id, req.userId);
    logAuditEvent({
      userId: req.userId, action: 'user_deleted', target: targetUser.email, ip: clientIp(req),
      details: { formsReassigned: reassigned }
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('delete_user_failed', { error: err.message });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// --- API tokens (read-only, for programmatic API access e.g. lodgely) ---
//
// Any logged-in user manages their own tokens. requireSession ensures a token
// can never be used to mint or enumerate tokens — only a real login can.

// List the current user's tokens (metadata only — the secret is never returned).
router.get('/tokens', authMiddleware, requireSession, (req, res) => {
  res.json({ tokens: apiTokens.listTokens(req.userId) });
});

// Create a token. The plaintext is returned exactly once, here.
router.post('/tokens', authMiddleware, requireSession, (req, res) => {
  if (!checkRateLimit(`tokens-create:${req.userId}`, 20, 60)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ error: 'Token name is required' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'Token name is too long (max 100 chars)' });
  }

  const created = apiTokens.createToken(req.userId, name);
  res.status(201).json({ token: created });
});

// Revoke a token.
router.delete('/tokens/:id', authMiddleware, requireSession, (req, res) => {
  const ok = apiTokens.revokeToken(req.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Token not found' });
  res.json({ ok: true });
});

module.exports = router;
