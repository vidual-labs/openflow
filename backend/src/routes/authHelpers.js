const { getDb } = require('../models/db');
const sessions = require('../models/sessions');
const { checkRateLimit } = require('../models/rateLimit');
const { logAuditEvent } = require('../models/auditLog');
const { sendSecurityNotice } = require('../models/systemMail');
const { hasWeakPassword } = require('../models/secureDefaults');

// Shared by the login routes (auth.js) and the self-service account routes
// (account.js).

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Exact match first, so an existing install that (before 0.44) ended up with
// two accounts differing only in case still logs each into its own; then a
// case-insensitive match, so "Admin@Example.com" finds admin@example.com.
function findUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    || db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE ORDER BY created_at LIMIT 1').get(email);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
    weakPassword: hasWeakPassword(user.id),
    twoFactorEnabled: !!user.twofa_enabled,
  };
}

// "Chrome on macOS" from a user-agent string — good enough to recognise your
// own browser in a notice or the sessions list.
function describeUserAgent(ua) {
  if (!ua) return 'an unknown client';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null;
  const os = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'an API client';
}

function requestContext(req) {
  return `${describeUserAgent(req.headers['user-agent'])}, IP ${clientIp(req)}`;
}

// Issues the session (and remembers the browser) once the password — and, for
// 2FA accounts, the e-mailed code or a remembered browser — checked out.
function completeLogin(req, res, user, { method, trustDevice = false }) {
  const cookieName = sessions.deviceCookieName(user.id);
  const existingToken = req.cookies?.[cookieName];
  const knownDevice = sessions.findDevice(existingToken, user.id);
  const hadOtherDevices = !knownDevice && sessions.listDevices(user.id).length > 0;

  const session = sessions.createSession(user.id, req);
  const deviceToken = sessions.rememberDevice(user.id, req, { existingToken, trusted2fa: trustDevice });
  res.cookie(sessions.SESSION_COOKIE, session.token, sessions.sessionCookieOptions());
  res.cookie(cookieName, deviceToken, sessions.deviceCookieOptions());

  logAuditEvent({
    userId: user.id, action: 'login_succeeded', target: user.email, ip: clientIp(req),
    details: { method, newDevice: !knownDevice },
  });

  // Tell the owner about a sign-in from a browser this account hasn't used
  // before — but only once they have a usual browser to compare against (no
  // burst of mails for every user right after upgrading), only for browsers
  // (an API client that logs in on every sync would otherwise mail each time;
  // those should use an API token anyway), and at most a few an hour. A login
  // just confirmed with an e-mailed code needs no second mail.
  const ua = req.headers['user-agent'] || '';
  if (hadOtherDevices && method !== 'password+email_code' && /^Mozilla\//.test(ua) && checkRateLimit(`new-device-notice:${user.id}`, 3, 3600)) {
    sendSecurityNotice(user.email, 'New sign-in to your OpenFlow account', [
      `Your OpenFlow account (${user.email}) was just signed in to from a browser it hasn't used before: ${requestContext(req)}.`,
      'If this was you, there is nothing to do.',
      'If it wasn\'t, change your password right away (Account page) and use "Sign out everywhere else". Turning on two-factor login keeps a stolen password from being enough.',
    ]);
  }

  res.json({ user: publicUser(user) });
}

module.exports = { clientIp, findUserByEmail, publicUser, describeUserAgent, requestContext, completeLogin };
