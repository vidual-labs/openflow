const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware, requireSession, REAUTH_WINDOW_MS } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { checkRateLimit, isRateLimited } = require('../models/rateLimit');
const { logAuditEvent } = require('../models/auditLog');
const logger = require('../utils/logger');
const { isAcceptableNewPassword, WEAK_PASSWORD_MESSAGE, flagWeakPassword } = require('../models/secureDefaults');
const { hashPassword, verifyPassword } = require('../models/passwords');
const sessions = require('../models/sessions');
const loginGuard = require('../models/loginGuard');
const twoFactor = require('../models/twoFactor');
const { isMailConfigured, sendSystemMail, sendSecurityNotice } = require('../models/systemMail');
const { clientIp, describeUserAgent, requestContext, lockedResponse } = require('./authHelpers');

// Self-service account security for the logged-in user, mounted under
// /api/auth (so it inherits the subdomain block and no-store caching): change
// password, opt in/out of the e-mailed login code, see and end sessions, and
// forget remembered browsers, and re-confirm the password for "sudo mode".
// Session-only: an API token can't reach any of it.
const router = Router();
router.use(['/account', '/password', '/2fa', '/sessions', '/devices', '/confirm-password'], authMiddleware, requireSession);

function currentUser(req) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
}

// Re-checks the password before a sensitive change. Throttled per user so a
// hijacked session can't be used to brute-force the password itself.
async function confirmPassword(req, res, user) {
  if (!checkRateLimit(`confirm-password:${user.id}`, 10, 15 * 60)) {
    res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    return false;
  }
  const password = req.body?.password ?? req.body?.currentPassword;
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Your current password is required' });
    return false;
  }
  const { ok } = await verifyPassword(password, user.password_hash);
  if (!ok) {
    logAuditEvent({ userId: user.id, action: 'password_confirm_failed', target: user.email, ip: clientIp(req) });
    res.status(401).json({ error: 'Your current password is not correct' });
    return false;
  }
  return true;
}

// "Sudo mode": re-enter the password to unlock the actions behind
// requireRecentAuth (backup download/restore, user management, minting API
// tokens) for REAUTH_WINDOW_MS — on this session only. Two-factor accounts
// confirm with the password alone (the session already passed the code).
//
// A wrong password counts toward the account's persistent lockout like a
// failed login, and while the account is locked this is refused too: a script
// running in the signed-in browser carries the same remembered-browser cookie,
// so the login lockout's exemption for known browsers doesn't apply here. The
// per-account throttle is shared with the other password re-checks above.
router.post('/confirm-password', asyncHandler(async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ip = clientIp(req);
  const rateKey = `confirm-password:${user.id}`;
  if (isRateLimited(rateKey, 10)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const lock = loginGuard.lockStatus(user.email);
  if (lock.locked) return lockedResponse(res, lock.retryAfterSeconds);

  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Your password is required' });
  }
  if (password.length > 1024) {
    return res.status(401).json({ error: 'That password is not correct.', code: 'wrong_password' });
  }

  const { ok } = await verifyPassword(password, user.password_hash);
  if (!ok) {
    checkRateLimit(rateKey, 10, 15 * 60);
    const failure = loginGuard.recordFailure(user.email);
    logAuditEvent({ userId: user.id, action: 'reauth_failed', target: user.email, ip, details: { failures: failure.failures } });
    if (failure.lockedMinutes) {
      logAuditEvent({ userId: user.id, action: 'login_locked', target: user.email, ip, details: { minutes: failure.lockedMinutes, via: 'confirm-password' } });
      if (failure.notify) {
        sendSecurityNotice(user.email, 'Failed password confirmations on your OpenFlow account', [
          `There have been ${failure.failures} failed attempts to sign in to or confirm the password of your OpenFlow account (${user.email}); the latest from ${requestContext(req)}.`,
          `Password sign-ins and confirmations are paused for ${failure.lockedMinutes} minutes.`,
          'If this wasn\'t you, someone may be guessing your password from a signed-in browser: change it and use "Sign out everywhere else" on your Account page.',
        ]);
      }
    }
    return res.status(401).json({ error: 'That password is not correct.', code: 'wrong_password' });
  }

  loginGuard.clearFailures(user.email);
  const at = sessions.markReauthenticated(req.sessionId);
  logAuditEvent({ userId: user.id, action: 'reauth_succeeded', target: user.email, ip });
  res.json({ ok: true, validUntil: at + REAUTH_WINDOW_MS });
}));

function currentDeviceId(req) {
  const device = sessions.findDevice(req.cookies?.[sessions.deviceCookieName(req.userId)], req.userId);
  return device ? device.id : null;
}

router.get('/account', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const deviceId = currentDeviceId(req);
  res.json({
    twoFactor: {
      enabled: !!user.twofa_enabled,
      // Can it be switched on here? Needs the operator's SMTP settings.
      available: twoFactor.isTwoFactorAvailable(),
      mailConfigured: isMailConfigured(),
      disabledByOperator: twoFactor.isTwoFactorDisabledByOperator(),
    },
    sessions: sessions.listSessions(user.id).map(s => ({
      id: s.id,
      client: describeUserAgent(s.user_agent),
      ip: s.ip,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      current: s.id === req.sessionId,
    })),
    devices: sessions.listDevices(user.id).map(d => ({
      id: d.id,
      client: describeUserAgent(d.user_agent),
      ip: d.ip,
      skipsCode: !!d.trusted_2fa,
      createdAt: d.created_at,
      lastUsedAt: d.last_used_at,
      expiresAt: d.expires_at,
      current: d.id === deviceId,
    })),
  });
});

// Change your own password. Signs out every other session and forgets every
// other remembered browser; this browser stays signed in.
router.post('/password', asyncHandler(async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!(await confirmPassword(req, res, user))) return;

  const { newPassword } = req.body;
  if (!isAcceptableNewPassword(newPassword, { email: user.email })) {
    return res.status(400).json({ error: WEAK_PASSWORD_MESSAGE });
  }
  if ((await verifyPassword(newPassword, user.password_hash)).ok) {
    return res.status(400).json({ error: 'The new password must be different from the current one' });
  }

  const hash = await hashPassword(newPassword);
  const db = getDb();
  const deviceId = currentDeviceId(req);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    sessions.revokeUserSessions(user.id, { exceptSessionId: req.sessionId });
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ? AND id != ?').run(user.id, deviceId || '');
  })();
  loginGuard.clearFailures(user.email);
  flagWeakPassword(user.id, false);
  logAuditEvent({ userId: user.id, action: 'password_changed', target: user.email, ip: clientIp(req) });
  sendSecurityNotice(user.email, 'Your OpenFlow password was changed', [
    `The password of your OpenFlow account (${user.email}) was just changed from ${requestContext(req)}. All other sessions were signed out.`,
    'If you didn\'t do this, contact your OpenFlow administrator right away.',
  ]);
  res.json({ ok: true });
}));

// Turning 2FA on is two steps, so it can't be switched on for a mailbox that
// doesn't actually receive the codes: (1) password → a code is e-mailed,
// (2) that code → 2FA is on.
router.post('/2fa/start', asyncHandler(async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!twoFactor.isTwoFactorAvailable()) {
    return res.status(409).json({ error: 'Two-factor login needs outgoing e-mail, which an administrator has not set up yet (Settings → System e-mail).' });
  }
  if (user.twofa_enabled) return res.status(409).json({ error: 'Two-factor login is already on' });
  if (!(await confirmPassword(req, res, user))) return;

  const challenge = twoFactor.createChallenge(user.id, 'enable', clientIp(req));
  if (!challenge) return res.status(429).json({ error: 'Too many codes requested. Wait 15 minutes and try again.' });
  try {
    await sendSystemMail({
      to: user.email,
      subject: 'Confirm two-factor login for OpenFlow',
      code: challenge.code,
      lines: [
        'Enter this code in OpenFlow to turn on two-factor login:',
        `It is valid for ${challenge.expiresInMinutes} minutes. From now on, signing in from a new browser will need a code like this one, sent to this address.`,
      ],
    });
  } catch (err) {
    twoFactor.discardChallenge(challenge.token);
    logger.error('twofa_enable_code_send_failed', { error: err.message });
    return res.status(503).json({ error: 'The confirmation e-mail could not be sent. Try again in a moment; if it keeps failing, ask an administrator to check Settings → System e-mail.' });
  }
  res.json({ challenge: challenge.token, email: twoFactor.maskEmail(user.email), expiresInMinutes: challenge.expiresInMinutes });
}));

router.post('/2fa/confirm', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { challenge, code } = req.body || {};
  const result = twoFactor.verifyChallenge(challenge, typeof code === 'string' ? code : '', 'enable');
  if (!result.ok || result.userId !== user.id) {
    if (result.reason === 'wrong_code' && result.userId === user.id) {
      return res.status(400).json({ error: `That code is not right. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.`, code: 'wrong_code' });
    }
    return res.status(400).json({ error: 'This code has expired or can no longer be used. Start again to get a new one.', code: 'challenge_invalid' });
  }

  getDb().prepare('UPDATE users SET twofa_enabled = 1 WHERE id = ?').run(user.id);
  // Browsers remembered before 2FA existed must not skip it; this one just
  // proved access to the mailbox, so it may.
  const cookieName = sessions.deviceCookieName(user.id);
  const deviceToken = sessions.rememberDevice(user.id, req, { existingToken: req.cookies?.[cookieName], trusted2fa: true });
  sessions.untrustDevices(user.id, { exceptDeviceId: sessions.findDevice(deviceToken, user.id)?.id });
  res.cookie(cookieName, deviceToken, sessions.deviceCookieOptions());
  logAuditEvent({ userId: user.id, action: '2fa_enabled', target: user.email, ip: clientIp(req) });
  res.json({ ok: true });
});

router.post('/2fa/disable', asyncHandler(async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.twofa_enabled) return res.status(409).json({ error: 'Two-factor login is already off' });
  if (!(await confirmPassword(req, res, user))) return;

  getDb().prepare('UPDATE users SET twofa_enabled = 0 WHERE id = ?').run(user.id);
  sessions.untrustDevices(user.id);
  logAuditEvent({ userId: user.id, action: '2fa_disabled', target: user.email, ip: clientIp(req) });
  sendSecurityNotice(user.email, 'Two-factor login was turned off for your OpenFlow account', [
    `Two-factor login for your OpenFlow account (${user.email}) was just turned off from ${requestContext(req)}. Signing in now only needs your password.`,
    'If you didn\'t do this, change your password right away and contact your OpenFlow administrator.',
  ]);
  res.json({ ok: true });
}));

router.delete('/sessions/:id', (req, res) => {
  if (!sessions.deleteSession(req.userId, req.params.id)) return res.status(404).json({ error: 'Session not found' });
  logAuditEvent({ userId: req.userId, action: 'session_revoked', ip: clientIp(req) });
  if (req.params.id === req.sessionId) res.clearCookie(sessions.SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// "Sign out everywhere else": every other session and every other remembered
// browser. This one stays signed in and remembered.
router.post('/sessions/revoke-others', (req, res) => {
  const db = getDb();
  const deviceId = currentDeviceId(req);
  db.transaction(() => {
    sessions.revokeUserSessions(req.userId, { exceptSessionId: req.sessionId });
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ? AND id != ?').run(req.userId, deviceId || '');
  })();
  logAuditEvent({ userId: req.userId, action: 'sessions_revoked_others', ip: clientIp(req) });
  res.json({ ok: true });
});

router.delete('/devices/:id', (req, res) => {
  if (!sessions.deleteDevice(req.userId, req.params.id)) return res.status(404).json({ error: 'Device not found' });
  logAuditEvent({ userId: req.userId, action: 'device_forgotten', ip: clientIp(req) });
  res.json({ ok: true });
});

module.exports = router;
