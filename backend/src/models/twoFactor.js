const crypto = require('crypto');
const { getDb } = require('./db');
const { isMailConfigured } = require('./systemMail');

// E-mailed one-time codes for the opt-in two-factor login (and for confirming
// that a user's mailbox receives them before 2FA is switched on).
//
// A challenge is identified by a random token the browser keeps between the
// password step and the code step; the DB stores only its hash. The 6-digit
// code is stored as HMAC(token, code), so even someone reading the DB can't
// brute-force a pending code without the token from the browser.

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Codes per user per window, across purposes: bounds both mail volume and how
// many codes someone who knows the password can try to guess
// (5 codes × 5 attempts per 15 minutes against a 1-in-a-million code).
const SEND_LIMIT = 5;
const SEND_WINDOW_MS = 15 * 60 * 1000;

const PURPOSES = ['login', 'enable'];

// OPENFLOW_2FA_DISABLED=true is the operator's escape hatch (SMTP down and
// everyone locked out): logins skip the code step and 2FA can't be enabled.
function isTwoFactorDisabledByOperator(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.OPENFLOW_2FA_DISABLED || '').trim().toLowerCase());
}

// Whether users can switch 2FA on right now.
function isTwoFactorAvailable() {
  return isMailConfigured() && !isTwoFactorDisabledByOperator();
}

function hashId(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function codeHash(token, code) {
  return crypto.createHmac('sha256', String(token)).update(String(code)).digest('hex');
}

function sendsInWindow(userId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM auth_challenges WHERE user_id = ? AND created_at > ?')
    .get(userId, Date.now() - SEND_WINDOW_MS).n;
}

// Creates a challenge and returns { token, code }, or null when the user has
// hit the send limit. Earlier pending challenges for the same purpose stop
// working, so only the code in the newest e-mail is valid.
function createChallenge(userId, purpose, ip = null) {
  if (!PURPOSES.includes(purpose)) throw new Error(`Unknown challenge purpose: ${purpose}`);
  if (sendsInWindow(userId) >= SEND_LIMIT) return null;
  const db = getDb();
  const token = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE auth_challenges SET consumed = 1 WHERE user_id = ? AND purpose = ? AND consumed = 0').run(userId, purpose);
    db.prepare(
      'INSERT INTO auth_challenges (id, user_id, purpose, code_hash, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(hashId(token), userId, purpose, codeHash(token, code), ip, now, now + CODE_TTL_MS);
  })();
  return { token, code, expiresInMinutes: CODE_TTL_MS / 60000 };
}

// Undoes a challenge whose e-mail could not be sent, so it doesn't count
// against the send limit.
function discardChallenge(token) {
  getDb().prepare('DELETE FROM auth_challenges WHERE id = ?').run(hashId(token));
}

// Checks a code. Returns { ok: true, userId } once (the challenge is consumed),
// otherwise { ok: false, reason } with reason 'invalid' (unknown/expired/used
// up — start over) or 'wrong_code' (try again; `attemptsLeft` says how often).
function verifyChallenge(token, code, purpose) {
  if (typeof token !== 'string' || !token || typeof code !== 'string') return { ok: false, reason: 'invalid' };
  const db = getDb();
  const row = db.prepare('SELECT * FROM auth_challenges WHERE id = ? AND purpose = ?').get(hashId(token), purpose);
  if (!row || row.consumed || row.expires_at <= Date.now() || row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'invalid' };
  }
  const normalized = code.replace(/\s+/g, '');
  const expected = Buffer.from(row.code_hash, 'hex');
  const actual = Buffer.from(codeHash(token, normalized), 'hex');
  if (/^\d{6}$/.test(normalized) && crypto.timingSafeEqual(expected, actual)) {
    // Conditional update: two concurrent submissions of the right code can't
    // both log in.
    const won = db.prepare('UPDATE auth_challenges SET consumed = 1 WHERE id = ? AND consumed = 0').run(row.id).changes === 1;
    return won ? { ok: true, userId: row.user_id } : { ok: false, reason: 'invalid' };
  }
  db.prepare('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  const attemptsLeft = MAX_ATTEMPTS - row.attempts - 1;
  if (attemptsLeft <= 0) return { ok: false, reason: 'invalid', userId: row.user_id };
  return { ok: false, reason: 'wrong_code', attemptsLeft, userId: row.user_id };
}

// "r•••@example.com" — enough for the user to recognise which mailbox to check.
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '•••';
  return `${local.slice(0, 1)}•••@${domain}`;
}

module.exports = {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  SEND_LIMIT,
  isTwoFactorDisabledByOperator,
  isTwoFactorAvailable,
  createChallenge,
  discardChallenge,
  verifyChallenge,
  maskEmail,
};
