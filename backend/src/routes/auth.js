const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware, requireAdmin, requireSession, readToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const apiTokens = require('../models/apiTokens');
const { checkRateLimit, isRateLimited } = require('../models/rateLimit');
const { logAuditEvent } = require('../models/auditLog');
const logger = require('../utils/logger');
const { isWeakPassword, isAcceptableNewPassword, WEAK_PASSWORD_MESSAGE, flagWeakPassword } = require('../models/secureDefaults');
const { hashPassword, verifyPassword } = require('../models/passwords');
const sessions = require('../models/sessions');
const loginGuard = require('../models/loginGuard');
const twoFactor = require('../models/twoFactor');
const { isMailConfigured, sendSystemMail, sendSecurityNotice } = require('../models/systemMail');
const { clientIp, findUserByEmail, publicUser, requestContext, completeLogin } = require('./authHelpers');

const router = Router();

// Every auth response is personal; never let a proxy or the browser cache it.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function lockedResponse(res, retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  res.set('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({
    error: `Too many failed sign-in attempts for this account. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    code: 'account_locked',
    retryAfterSeconds,
  });
}

// Step 1: e-mail + password. Answers with the session (as before), or — for
// an account with two-factor login on, from a browser it doesn't remember —
// with { twoFactorRequired, challenge } after e-mailing a 6-digit code, which
// step 2 (/login/verify) exchanges for the session.
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  // Non-string values would throw inside the SQLite binding / bcrypt and
  // surface as an HTML 500 page, bypassing the failed-login counter.
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  if (email.length > 254 || password.length > 1024) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  // Per-IP throttle against one source spraying many accounts (in memory;
  // only failed attempts count). Per-account protection is the persistent,
  // escalating lockout in models/loginGuard.js.
  const ip = clientIp(req);
  const ipKey = `login-ip:${ip}`;
  if (isRateLimited(ipKey, 20)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const user = findUserByEmail(email);
  const device = user ? sessions.findDevice(req.cookies?.[sessions.deviceCookieName(user.id)], user.id) : null;
  const lock = loginGuard.lockStatus(email);
  if (lock.locked && !device) {
    return lockedResponse(res, lock.retryAfterSeconds);
  }

  // Always runs a bcrypt compare (against a dummy hash for unknown e-mails),
  // so response timing doesn't reveal whether an account exists.
  const { ok, needsRehash } = await verifyPassword(password, user ? user.password_hash : null);
  if (!user || !ok) {
    checkRateLimit(ipKey, 20, 60);
    const failure = loginGuard.recordFailure(email);
    logAuditEvent({ userId: user ? user.id : null, action: 'login_failed', target: String(email).toLowerCase(), ip, details: { failures: failure.failures } });
    if (failure.lockedMinutes) {
      logAuditEvent({ userId: user ? user.id : null, action: 'login_locked', target: String(email).toLowerCase(), ip, details: { minutes: failure.lockedMinutes } });
      if (failure.notify && user) {
        sendSecurityNotice(user.email, 'Failed sign-in attempts on your OpenFlow account', [
          `There have been ${failure.failures} failed attempts to sign in to your OpenFlow account (${user.email}); the latest from ${requestContext(req)}.`,
          `Sign-ins with a password are paused for ${failure.lockedMinutes} minutes. Browsers you have signed in with before are not affected.`,
          'If this wasn\'t you, someone is guessing your password. Make sure it is long and unique, and consider turning on two-factor login on your Account page.',
        ]);
      }
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  loginGuard.clearFailures(email);
  // The plaintext is only ever at hand here, so this is where a weak or
  // well-known password (e.g. a pre-0.16 `admin123`) gets noticed; the admin
  // UI shows a "change your password" banner while the flag is set.
  flagWeakPassword(user.id, isWeakPassword(password, { email: user.email }));
  if (needsRehash) {
    // Upgrade a hash from an older, cheaper bcrypt cost in the background;
    // the conditional WHERE leaves a password changed meanwhile alone.
    hashPassword(password)
      .then(hash => getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?').run(hash, user.id, user.password_hash))
      .catch(err => logger.warn('password_rehash_failed', { error: err.message }));
  }

  if (user.twofa_enabled && !twoFactor.isTwoFactorDisabledByOperator()) {
    if (device && device.trusted_2fa) {
      return completeLogin(req, res, user, { method: 'password+remembered_device', trustDevice: true });
    }
    if (!isMailConfigured()) {
      logAuditEvent({ userId: user.id, action: 'login_code_unavailable', target: user.email, ip });
      logger.error('login_code_unavailable', { hint: 'A user with two-factor login cannot sign in because SMTP_* is not configured. Configure it, or set OPENFLOW_2FA_DISABLED=true temporarily.' });
      return res.status(503).json({ error: 'Your account needs an e-mailed login code, but this server can\'t send e-mail right now. Ask the administrator to check the SMTP settings.' });
    }
    const challenge = twoFactor.createChallenge(user.id, 'login', ip);
    if (!challenge) {
      return res.status(429).json({ error: 'Too many login codes requested. Wait 15 minutes, or use the code from the most recent e-mail.' });
    }
    try {
      await sendSystemMail({
        to: user.email,
        subject: 'Your OpenFlow login code',
        code: challenge.code,
        lines: [
          'Your OpenFlow login code is:',
          `It is valid for ${challenge.expiresInMinutes} minutes and can be used once. Requested from ${requestContext(req)}.`,
          'If you didn\'t just try to sign in, someone knows your password: change it right away.',
        ],
      });
    } catch (err) {
      twoFactor.discardChallenge(challenge.token);
      logger.error('login_code_send_failed', { error: err.message });
      return res.status(503).json({ error: 'The login code e-mail could not be sent. Try again in a moment; if it keeps failing, ask the administrator to check the SMTP settings.' });
    }
    logAuditEvent({ userId: user.id, action: 'login_code_sent', target: user.email, ip });
    return res.json({
      twoFactorRequired: true,
      challenge: challenge.token,
      email: twoFactor.maskEmail(user.email),
      expiresInMinutes: challenge.expiresInMinutes,
    });
  }

  return completeLogin(req, res, user, { method: 'password' });
}));

// Step 2 for two-factor accounts: the e-mailed code. `remember` (default
// true) lets this browser skip the code for 30 days.
router.post('/login/verify', (req, res) => {
  const { challenge, code, remember } = req.body || {};
  const ip = clientIp(req);
  if (!checkRateLimit(`login-verify-ip:${ip}`, 30, 60)) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  if (typeof challenge !== 'string' || typeof code !== 'string') {
    return res.status(400).json({ error: 'Code required' });
  }

  const result = twoFactor.verifyChallenge(challenge, code, 'login');
  if (!result.ok) {
    logAuditEvent({ userId: result.userId || null, action: 'login_code_failed', ip, details: { reason: result.reason } });
    if (result.reason === 'wrong_code') {
      return res.status(401).json({ error: `That code is not right. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.`, code: 'wrong_code' });
    }
    return res.status(401).json({ error: 'This code has expired or can no longer be used. Sign in again to get a new one.', code: 'challenge_invalid' });
  }

  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(result.userId);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  return completeLogin(req, res, user, { method: 'password+email_code', trustDevice: remember !== false });
});

// Ends this browser's session server-side. The remembered-browser cookie
// stays, so the next login here still skips the e-mailed code.
router.post('/logout', (req, res) => {
  const token = readToken(req);
  if (token && !apiTokens.looksLikeApiToken(token)) sessions.deleteSessionByToken(token);
  res.clearCookie(sessions.SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, role, created_at, twofa_enabled FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

// Self-service: password, two-factor login, sessions, remembered browsers.
router.use(require('./account'));

// --- Multi-user management (admin only) ---

// List all users
router.get('/users', authMiddleware, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, email, role, created_at, twofa_enabled FROM users ORDER BY created_at DESC').all()
    .map(({ twofa_enabled, ...u }) => ({ ...u, twoFactorEnabled: !!twofa_enabled }));
  res.json({ users });
});

// Create / invite user
router.post('/users', authMiddleware, requireAdmin, asyncHandler(async (req, res) => {
  if (!checkRateLimit(`users-create:${req.userId}`, 20, 60)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const { password, role } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  if (!isAcceptableNewPassword(password, { email })) {
    return res.status(400).json({ error: WEAK_PASSWORD_MESSAGE });
  }

  const db = getDb();
  // Case-insensitive: logins match e-mails case-insensitively, so two
  // accounts differing only in case must not be created.
  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (existing) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  const { randomUUID: uuid } = require('crypto');
  const hash = await hashPassword(password);
  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    id, email, hash, role === 'admin' ? 'admin' : 'user'
  );

  logAuditEvent({ userId: req.userId, action: 'user_created', target: email, ip: clientIp(req), details: { role: role === 'admin' ? 'admin' : 'user' } });
  res.status(201).json({ user: { id, email, role: role === 'admin' ? 'admin' : 'user', twoFactorEnabled: false } });
}));

// Update a user: role, password, or (twoFactor: false) switch off their
// two-factor login when they have lost access to their mailbox.
router.put('/users/:id', authMiddleware, requireAdmin, asyncHandler(async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { role, password, twoFactor } = req.body;
  // Validate everything before changing anything.
  if (role && req.params.id === req.userId && role !== 'admin') {
    // An admin demoting themselves would lock the last admin out (the role
    // change also revokes their session); make that a deliberate act by
    // another admin instead.
    return res.status(400).json({ error: 'You cannot change your own role' });
  }
  if (password && !isAcceptableNewPassword(password, { email: user.email })) {
    return res.status(400).json({ error: WEAK_PASSWORD_MESSAGE });
  }

  if (role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'user', req.params.id);
    sessions.revokeUserSessions(req.params.id);
    logAuditEvent({ userId: req.userId, action: 'user_role_changed', target: user.email, ip: clientIp(req), details: { role: role === 'admin' ? 'admin' : 'user' } });
  }
  if (password) {
    const hash = await hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
    // A reset password ends every session and forgets every remembered
    // browser: whoever had the old one is out.
    sessions.revokeUserSessions(req.params.id, { devices: true });
    loginGuard.clearFailures(user.email);
    flagWeakPassword(req.params.id, false);
    logAuditEvent({ userId: req.userId, action: 'user_password_changed', target: user.email, ip: clientIp(req) });
    sendSecurityNotice(user.email, 'Your OpenFlow password was reset', [
      `An administrator set a new password for your OpenFlow account (${user.email}). All your sessions were signed out.`,
      'If you didn\'t expect this, contact your OpenFlow administrator.',
    ]);
  }
  if (twoFactor === false) {
    db.prepare('UPDATE users SET twofa_enabled = 0 WHERE id = ?').run(req.params.id);
    sessions.untrustDevices(req.params.id);
    logAuditEvent({ userId: req.userId, action: 'user_2fa_reset', target: user.email, ip: clientIp(req) });
    sendSecurityNotice(user.email, 'Two-factor login was turned off for your OpenFlow account', [
      `An administrator turned off two-factor login for your OpenFlow account (${user.email}). Signing in now only needs your password.`,
      'You can turn it back on from your Account page. If you didn\'t ask for this, contact your OpenFlow administrator.',
    ]);
  }

  const updated = db.prepare('SELECT id, email, role, created_at, twofa_enabled FROM users WHERE id = ?').get(req.params.id);
  const { twofa_enabled, ...rest } = updated;
  res.json({ user: { ...rest, twoFactorEnabled: !!twofa_enabled } });
}));

// Force-expire a user's existing sessions and remembered browsers without
// touching their password — e.g. after a suspected compromise. Takes effect
// on their very next request, and their next login needs the e-mailed code
// again if they use two-factor login.
router.post('/users/:id/revoke-sessions', authMiddleware, requireAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  sessions.revokeUserSessions(req.params.id, { devices: true });
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
    // failing the FK check, and revoke their API tokens and sessions.
    const reassigned = db.transaction((userId, newOwnerId) => {
      const { changes } = db.prepare('UPDATE forms SET user_id = ? WHERE user_id = ?').run(newOwnerId, userId);
      db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(userId);
      sessions.deleteAllForUser(userId);
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
