const bcrypt = require('bcryptjs');

// Values that were once documented defaults (docker-compose.yml shipped
// `admin123` until 0.16) or are otherwise the first thing anyone would try. An
// admin password from this list is a full takeover of an internet-reachable
// install.
const KNOWN_WEAK_PASSWORDS = [
  'admin123',
  'admin',
  'password',
  'changeme',
  'change-me',
  'openflow',
  '12345678',
  '123456789',
  '1234567890',
];

// Passwords that meet the length rule but sit at the top of every leaked-
// password list, so they fall to the first few guesses of a credential-
// stuffing run. Compared case-insensitively. Patterns that pad a common word
// with digits are caught separately by looksPredictable().
const COMMON_LONG_PASSWORDS = new Set([
  '0987654321', '1111111111', '1122334455', '1234512345', '1234567890a',
  '1234567891', '12345678910', '123456789a', '123456789q', '1q2w3e4r5t',
  '1q2w3e4r5t6y', '1qaz2wsx3edc', 'a1234567890', 'aaaaaaaaaa', 'abc1234567',
  'abcd123456', 'abcdefghij', 'abcdefghijk', 'admin12345', 'admin123456',
  'administrator', 'asdfghjkl1', 'asdfghjkl123', 'baseball123', 'basketball',
  'changeme123', 'football123', 'iloveyou12', 'iloveyou123', 'letmein123',
  'liverpool1', 'login12345', 'michael123', 'monkey12345', 'passw0rd123',
  'passwort123', 'password01', 'password1!', 'password12', 'password123',
  'password1234', 'password12345', 'password2024', 'password2025', 'password2026',
  'p@ssw0rd123', 'p@ssword123', 'q1w2e3r4t5', 'q1w2e3r4t5y6', 'qazwsxedc1',
  'qazwsxedcrfv', 'qwerty1234', 'qwerty12345', 'qwerty123456', 'qwertyuiop',
  'qwertyuiop1', 'qwertz1234', 'qwertz12345', 'qwertzuiop', 'starwars123',
  'sunshine123', 'superman123', 'trustno1234', 'welcome123', 'welcome1234',
  'willkommen', 'willkommen1', 'willkommen123', 'zaq12wsxcde', 'zxcvbnm123',
  'openflow123', 'openflow2024', 'openflow2025', 'openflow2026', 'hallo12345',
  'hallo123456', 'passwort1234', 'geheim1234', 'geheim12345', 'dragon12345',
]);

// Common base words that, followed only by digits/symbols, make up most
// guessable "long" passwords (Password2026!, Welcome123456, admin!2345678).
const PREDICTABLE_BASES = [
  'password', 'passwort', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'welcome', 'willkommen',
  'admin', 'administrator', 'openflow', 'qwerty', 'qwertz', 'letmein', 'iloveyou',
  'changeme', 'hallo', 'geheim', 'secret', 'login', 'test',
];

// Rejects passwords that are long enough but trivially guessable: a single
// repeated character, a straight run of digits or keyboard row, a common base
// word padded with digits/symbols, or the account's own e-mail address.
function looksPredictable(password, email) {
  const pw = password.toLowerCase();
  if (/^(.)\1+$/.test(pw)) return true;
  if ('01234567890123456789'.includes(pw) || '98765432109876543210'.includes(pw)) return true;
  for (const row of ['qwertyuiopasdfghjklzxcvbnm', 'qwertzuiopasdfghjklyxcvbnm', '1qaz2wsx3edc4rfv5tgb6yhn']) {
    if (row.includes(pw)) return true;
  }
  for (const base of PREDICTABLE_BASES) {
    if (pw.startsWith(base) && /^[\d\W_]*$/.test(pw.slice(base.length))) return true;
  }
  if (typeof email === 'string' && email) {
    const address = email.toLowerCase();
    const local = address.split('@')[0];
    if (pw === address || (local.length >= 4 && pw.replace(/[\d\W_]+$/, '') === local)) return true;
  }
  return false;
}

const MIN_PASSWORD_LENGTH = 10;
// bcrypt only looks at the first 72 bytes; refuse longer input rather than
// silently ignoring the tail (and spending hash time on megabyte bodies).
const MAX_PASSWORD_LENGTH = 72;

// `email` (optional) is the account's address, so a password that is just
// the address or its local part is refused too.
function isWeakPassword(password, { email } = {}) {
  if (typeof password !== 'string') return true;
  if (password.length < MIN_PASSWORD_LENGTH) return true;
  const lower = password.toLowerCase();
  return KNOWN_WEAK_PASSWORDS.includes(lower) || COMMON_LONG_PASSWORDS.has(lower) || looksPredictable(password, email);
}

// The rule for a password being *set* (not just flagged at login): not weak,
// and within bcrypt's 72-byte input limit.
function isAcceptableNewPassword(password, { email } = {}) {
  return typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_LENGTH && !isWeakPassword(password, { email });
}

const WEAK_PASSWORD_MESSAGE = `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters and not a common or easily guessed password (no repeated characters, number/keyboard runs, "Password123"-style variations or your e-mail address)`;

// Since 0.44 sessions are stored server-side and nothing is signed with
// JWT_SECRET any more, so even a publicly known value is harmless. Returns a
// note for operators who still set it, so they can tidy up their .env.
function checkJwtSecret(env = process.env) {
  if (!env.JWT_SECRET) return [];
  return ['JWT_SECRET is no longer used (login sessions are stored server-side since 0.44). You can remove it from your environment.'];
}

// Throws when ADMIN_PASSWORD would seed the first admin with a weak or
// well-known password. Only called when seeding actually happens, so an
// existing install whose old .env still carries `ADMIN_PASSWORD=admin123`
// keeps booting (the env var is ignored once the admin exists) — the account
// check below flags it instead.
function assertSeedPasswordStrong(password) {
  if (password && isWeakPassword(password)) {
    throw new Error(
      `ADMIN_PASSWORD is too weak (at least ${MIN_PASSWORD_LENGTH} characters, not a well-known default). Set a stronger one, or leave ADMIN_PASSWORD unset to get a random one-time password printed to the log.`
    );
  }
}

// Users whose stored password is one of the well-known defaults. Kept in
// memory: filled by a scan at boot, updated on every login (where the
// plaintext is at hand) and cleared when the password changes. The admin UI
// shows a banner while the logged-in user is in here.
const flaggedUsers = new Set();

function flagWeakPassword(userId, weak) {
  if (weak) flaggedUsers.add(userId);
  else flaggedUsers.delete(userId);
}

function hasWeakPassword(userId) {
  return flaggedUsers.has(userId);
}

// bcrypt-compares admin accounts against the known-defaults list, after the
// server is already listening (bcryptjs is pure JS; ~10 compares per admin
// would otherwise delay boot). Only the list is checked — a stored hash can't
// reveal its length — and only admins, since an admin takeover is the risk.
async function scanForDefaultPasswords(db, { limit = 10 } = {}) {
  const admins = db.prepare("SELECT id, email, password_hash FROM users WHERE role = 'admin' LIMIT ?").all(limit);
  const found = [];
  for (const user of admins) {
    let weak = false;
    for (const pw of KNOWN_WEAK_PASSWORDS) {
      if (await bcrypt.compare(pw, user.password_hash)) { weak = true; break; }
    }
    flagWeakPassword(user.id, weak);
    if (weak) found.push(user.email);
  }
  return found;
}

function resetWeakPasswordFlags() {
  flaggedUsers.clear();
}

module.exports = {
  KNOWN_WEAK_PASSWORDS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  WEAK_PASSWORD_MESSAGE,
  isWeakPassword,
  isAcceptableNewPassword,
  checkJwtSecret,
  assertSeedPasswordStrong,
  flagWeakPassword,
  hasWeakPassword,
  scanForDefaultPasswords,
  resetWeakPasswordFlags,
};
