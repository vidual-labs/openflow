const { version: appVersion } = require('../../package.json');

// Bump BACKUP_VERSION whenever the data shape inside a backup changes in a way
// that needs a transform to be restored into the current schema. Each step is
// described by a migration in MIGRATIONS so that older backups can be upgraded
// before they are loaded back into the database.
const BACKUP_VERSION = 1;

// Tables included in a full backup, in dependency order (parents before
// children). Restores wipe and re-insert in this order with foreign keys
// disabled, so the order is mostly cosmetic but keeps the file readable.
const TABLES = [
  'users',
  'forms',
  'submissions',
  'integrations',
  'analytics_events',
  'site_settings',
  'slug_history',
];

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function listTables(db) {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  const present = new Set(rows);
  return TABLES.filter((t) => present.has(t));
}

// Produce a serialisable snapshot of every backed-up table.
function createBackup(db) {
  const tables = {};
  for (const table of listTables(db)) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  return {
    openflow_backup: true,
    version: BACKUP_VERSION,
    app_version: appVersion,
    created_at: new Date().toISOString(),
    tables,
  };
}

// Lightweight summary used by the UI to show what is in the database before a
// backup is taken (and after a restore).
function backupSummary(db) {
  const counts = {};
  for (const table of listTables(db)) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    counts[table] = row ? row.n : 0;
  }
  return { version: BACKUP_VERSION, app_version: appVersion, counts };
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('Invalid backup file: expected a JSON object');
  }
  if (backup.openflow_backup !== true) {
    throw new Error('This file is not an OpenFlow backup');
  }
  if (!backup.tables || typeof backup.tables !== 'object') {
    throw new Error('Invalid backup file: missing "tables"');
  }
  const version = backup.version == null ? 0 : Number(backup.version);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error('Invalid backup file: bad version');
  }
  if (version > BACKUP_VERSION) {
    throw new Error(
      `Backup was created by a newer version of OpenFlow (backup format v${version}, this server supports up to v${BACKUP_VERSION}). Please upgrade before restoring.`
    );
  }
  return backup;
}

// Ordered chain of transforms. Each migration upgrades the `tables` payload
// from `from` to `from + 1`. When the schema changes, add an entry here and
// bump BACKUP_VERSION — restore replays every step needed to reach the current
// version, so a v1 backup restored on a v3 server runs 1→2 then 2→3.
const MIGRATIONS = [
  // Example shape for future schema changes:
  // {
  //   from: 1,
  //   to: 2,
  //   migrate(tables) {
  //     for (const form of tables.forms || []) form.new_column = form.new_column ?? '';
  //     return tables;
  //   },
  // },
];

// Bring a (validated) backup up to the current BACKUP_VERSION.
function migrateBackup(backup) {
  let version = backup.version == null ? 0 : Number(backup.version);
  let tables = backup.tables || {};

  // 0 → 1: legacy backups predate the explicit version field and may be
  // missing columns added by earlier in-place DB migrations. Fill the known
  // defaults so the rows satisfy the current schema. The column-intersection
  // performed during insert tolerates any remaining extra/missing fields.
  if (version < 1) {
    for (const u of tables.users || []) {
      if (u.role == null) u.role = 'user';
    }
    for (const f of tables.forms || []) {
      if (f.subdomain === undefined) f.subdomain = null;
      if (f.gtm_id == null) f.gtm_id = '';
    }
    version = 1;
  }

  for (const m of MIGRATIONS) {
    if (version === m.from) {
      tables = m.migrate(tables) || tables;
      version = m.to;
    }
  }

  return { ...backup, version, tables };
}

// SQLite (via better-sqlite3) only binds null/number/string/bigint/Buffer.
// JSON backups can carry booleans or nested objects, so coerce them.
function normalizeValue(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

// Replace the entire database contents with the backup. Runs inside a single
// transaction so a failure leaves the existing data untouched. Returns a
// summary of what was restored.
//
// `options.preserveUser` is the account performing the restore (its full row
// from the users table). It is re-inserted after the wipe so an admin can
// never lock themselves out by restoring a backup that lacks their account —
// they keep their existing credentials, id (so the active session stays
// valid) and admin role.
function restoreBackup(db, rawBackup, options = {}) {
  const migrated = migrateBackup(validateBackup(rawBackup));
  const preserveUser = options.preserveUser || null;

  // foreign_keys is a no-op inside a transaction, so toggle it outside.
  const fkPrevious = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');

  let restored = { tables: 0, rows: 0, adminPreserved: false };
  try {
    const run = db.transaction(() => {
      const present = listTables(db);

      // Wipe children first.
      for (const table of [...present].reverse()) {
        db.exec(`DELETE FROM ${table}`);
      }

      let rowCount = 0;
      let tableCount = 0;
      for (const table of present) {
        const rows = migrated.tables[table];
        if (!Array.isArray(rows)) continue;
        tableCount += 1;
        const validCols = new Set(tableColumns(db, table));
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const keys = Object.keys(row).filter((k) => validCols.has(k));
          if (keys.length === 0) continue;
          const placeholders = keys.map(() => '?').join(', ');
          const stmt = db.prepare(
            `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`
          );
          stmt.run(...keys.map((k) => normalizeValue(row[k])));
          rowCount += 1;
        }
      }

      // Re-assert the acting admin so the restore can't lock them out. Drop any
      // restored row that would collide on id or email first, then re-insert
      // their original credentials with the admin role.
      let adminPreserved = false;
      if (preserveUser && preserveUser.id && preserveUser.email) {
        // Capture the backup's user id for this email before deleting it.
        // When restoring to a fresh deployment the backup user may have a
        // different id than the acting admin (UUIDs are regenerated on first
        // sign-up). Their forms would otherwise be orphaned because the
        // forms.user_id still points to the now-deleted backup id.
        const backupUser = db.prepare('SELECT id FROM users WHERE email = ?').get(preserveUser.email);
        const backupUserId = backupUser ? backupUser.id : null;

        db.prepare('DELETE FROM users WHERE id = ? OR email = ?').run(
          preserveUser.id,
          preserveUser.email
        );
        db.prepare(
          'INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(
          preserveUser.id,
          preserveUser.email,
          preserveUser.password_hash,
          'admin',
          preserveUser.created_at || new Date().toISOString()
        );

        // If the backup had a matching user under a different id, their forms
        // are now orphaned. Reassign them so the admin can see them immediately.
        if (backupUserId && backupUserId !== preserveUser.id) {
          db.prepare('UPDATE forms SET user_id = ? WHERE user_id = ?').run(
            preserveUser.id,
            backupUserId
          );
        }

        adminPreserved = true;
      }

      return { tables: tableCount, rows: rowCount, adminPreserved };
    });
    restored = run();
  } finally {
    db.pragma(`foreign_keys = ${fkPrevious ? 'ON' : 'OFF'}`);
  }

  return { ...restored, version: migrated.version };
}

module.exports = {
  BACKUP_VERSION,
  TABLES,
  createBackup,
  backupSummary,
  validateBackup,
  migrateBackup,
  restoreBackup,
};
