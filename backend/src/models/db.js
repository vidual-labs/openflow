const Database = require('better-sqlite3');
const path = require('path');

let db;

function getDb() {
  if (!db) {
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/openflow.db');
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function resetDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled Form',
      slug TEXT UNIQUE NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      end_screen TEXT NOT NULL DEFAULT '{}',
      theme TEXT NOT NULL DEFAULT '{}',
      gtm_id TEXT DEFAULT '',
      published INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id)
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id)
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id TEXT NOT NULL,
      event TEXT NOT NULL,
      session_id TEXT,
      step_index INTEGER,
      step_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id)
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_form ON analytics_events(form_id, event, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events(form_id, session_id);

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS slug_history (
      old_slug TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id)
    );

    CREATE INDEX IF NOT EXISTS idx_slug_history_form ON slug_history(form_id);

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      token_prefix TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

    -- Tracks each attempt to deliver a submission to a form's integrations
    -- (webhook/email/Sheets) so a transient failure (client's endpoint down,
    -- SMTP hiccup) retries with backoff instead of silently losing the lead,
    -- and surfaces as a dead letter for manual retry if all attempts fail.
    CREATE TABLE IF NOT EXISTS integration_deliveries (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id),
      FOREIGN KEY (integration_id) REFERENCES integrations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_deliveries_form ON integration_deliveries(form_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_deliveries_due ON integration_deliveries(status, next_attempt_at);

    -- Trail of security-relevant events (logins, user/admin changes, backup
    -- and restore) for post-incident review. user_id is nullable (e.g. a
    -- failed login for an email that doesn't exist has no user to attribute
    -- it to) and intentionally has no FOREIGN KEY, so deleting a user never
    -- deletes their history from the log.
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      ip TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

    -- Login state (models/sessions.js, models/loginGuard.js,
    -- models/twoFactor.js). Only SHA-256 hashes of the random tokens are
    -- stored, so a leaked DB or backup can't be replayed as a login. No
    -- FOREIGN KEYs: a restore wipes and re-inserts users with foreign keys
    -- off, and deleting a user clears these rows explicitly. None of these
    -- tables are part of a backup.
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- A browser that has logged in to an account before. Exempts that
    -- browser from the account lockout, and — when trusted_2fa is set — from
    -- the e-mailed login code for 30 days. It never replaces the password.
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      trusted_2fa INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);

    -- E-mailed one-time codes (login, enabling 2FA). id is the hash of the
    -- challenge token the browser holds; the code itself is only stored as a
    -- hash keyed by that token.
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_user ON auth_challenges(user_id, purpose, created_at);

    -- Failed logins per (lower-cased) e-mail, whether or not the account
    -- exists, so a lockout can't be used to find out which accounts do.
    CREATE TABLE IF NOT EXISTS login_failures (
      email TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      last_failure_at INTEGER NOT NULL,
      notified_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migrate: add role column if missing (existing DBs)
  try {
    db.prepare('SELECT role FROM users LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    console.log('Migration: added role column to users');
  }

  // Migrate: add token_version column to users (existing DBs). Bumped on
  // password change, role change, or an explicit admin "log out everywhere"
  // so a stolen/old JWT stops working immediately instead of riding out its
  // full 7-day expiry — see middleware/auth.js.
  try {
    db.prepare('SELECT token_version FROM users LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0');
    console.log('Migration: added token_version column to users');
  }

  // Migrate: opt-in e-mail two-factor login (existing DBs).
  try {
    db.prepare('SELECT twofa_enabled FROM users LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE users ADD COLUMN twofa_enabled INTEGER DEFAULT 0');
    console.log('Migration: added twofa_enabled column to users');
  }

  // Migrate: add subdomain column to forms (existing DBs).
  // SQLite can't add a column with a UNIQUE constraint inline, so we add the
  // column nullable and enforce uniqueness with a partial unique index.
  try {
    db.prepare('SELECT subdomain FROM forms LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE forms ADD COLUMN subdomain TEXT');
    console.log('Migration: added subdomain column to forms');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_forms_subdomain ON forms(subdomain) WHERE subdomain IS NOT NULL');

  // Migrate: stable field keys inside the `steps` JSON (0.46, ROADMAP OF-1).
  // Idempotent and cheap, so it simply runs on every boot; it also catches
  // forms restored from a pre-0.46 backup (routes/admin.js calls it after a
  // restore for the same reason).
  const migratedKeys = ensureFormFieldKeys(db);
  if (migratedKeys > 0) console.log(`Migration: added field keys to ${migratedKeys} form(s)`);

  // Seed admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@openflow.local';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existing) {
    const { randomUUID: uuid } = require('crypto');
    // Never fall back to a hardcoded, publicly-documented password
    // (e.g. 'admin123'). If ADMIN_PASSWORD isn't set, generate a random
    // one-time password and print it once so the operator can log in and
    // change it — a leaked/guessed well-known default is a full admin
    // takeover given this is an internet-reachable, single-tenant app.
    const crypto = require('crypto');
    const generatedPassword = !process.env.ADMIN_PASSWORD ? crypto.randomBytes(12).toString('base64url') : null;
    require('./secureDefaults').assertSeedPasswordStrong(process.env.ADMIN_PASSWORD);
    const adminPassword = process.env.ADMIN_PASSWORD || generatedPassword;
    const hash = require('./passwords').hashPasswordSync(adminPassword);
    db.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(uuid(), adminEmail, hash);
    if (generatedPassword) {
      console.log('='.repeat(60));
      console.log(`Admin user created: ${adminEmail}`);
      console.log(`Generated admin password: ${generatedPassword}`);
      console.log('Log in and change this password. Set ADMIN_PASSWORD to control it explicitly.');
      console.log('='.repeat(60));
    } else {
      console.log(`Admin user created: ${adminEmail}`);
    }
  } else {
    // Ensure admin has admin role
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ? AND (role IS NULL OR role != 'admin')").run(adminEmail);
  }
}

// Gives every leaf field of every form a key and points conditions at keys
// (utils/fieldKeys.js). Rows already in shape are left untouched, including
// their updated_at. Returns the number of forms rewritten.
function ensureFormFieldKeys(db) {
  const { prepareSteps } = require('../utils/fieldKeys');
  const rows = db.prepare('SELECT id, steps FROM forms').all();
  const update = db.prepare('UPDATE forms SET steps = ? WHERE id = ?');
  let changed = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      let steps;
      try { steps = JSON.parse(row.steps); } catch { continue; }
      if (!Array.isArray(steps)) continue;
      const prepared = prepareSteps(steps, { strict: false });
      if (prepared.error) continue;
      const next = JSON.stringify(prepared.steps);
      if (next !== row.steps) {
        update.run(next, row.id);
        changed += 1;
      }
    }
  });
  run();
  return changed;
}

module.exports = { getDb, initDb, resetDb, ensureFormFieldKeys };
