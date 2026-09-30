const bcrypt = require('bcryptjs');

// Values that were once documented defaults (docker-compose.yml shipped
// `admin123` / `change-me-in-production` until 0.16) or are otherwise the
// first thing anyone would try. A JWT secret from this list lets anyone who
// learns a user id forge that user's session; an admin password from it is a
// full takeover of an internet-reachable install.
const KNOWN_PUBLIC_SECRETS = [
  'change-me-in-production',
  'changeme',
  'change-me',
  'secret',
  'jwt-secret',
  'jwt_secret',
  'openflow',
];

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

const MIN_PASSWORD_LENGTH = 10;
const MIN_SECRET_LENGTH = 32;

function isWeakPassword(password) {
  if (typeof password !== 'string') return true;
  return password.length < MIN_PASSWORD_LENGTH || KNOWN_WEAK_PASSWORDS.includes(password.toLowerCase());
}

// Throws for a JWT secret that is publicly known — starting would hand out
// forgeable sessions. Returns warnings for merely short secrets.
function checkJwtSecret(env = process.env) {
  const secret = env.JWT_SECRET;
  if (!secret) return [];
  if (KNOWN_PUBLIC_SECRETS.includes(secret.trim().toLowerCase())) {
    throw new Error(
      'JWT_SECRET is set to a publicly known default value. Remove JWT_SECRET to let OpenFlow generate and persist a random one, or set a random value of at least 32 characters (e.g. `openssl rand -hex 32`). Existing sessions will need to log in again.'
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return [`JWT_SECRET is only ${secret.length} characters long; use at least ${MIN_SECRET_LENGTH} random characters.`];
  }
  return [];
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
  KNOWN_PUBLIC_SECRETS,
  KNOWN_WEAK_PASSWORDS,
  MIN_PASSWORD_LENGTH,
  isWeakPassword,
  checkJwtSecret,
  assertSeedPasswordStrong,
  flagWeakPassword,
  hasWeakPassword,
  scanForDefaultPasswords,
  resetWeakPasswordFlags,
};
