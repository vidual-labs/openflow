const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { createBackup, backupSummary, restoreBackup } = require('../models/backup');
const { listScheduledBackups, readScheduledBackup } = require('../models/backupScheduler');

const router = Router();

// Everything under /api/admin is admin-only.
router.use(authMiddleware, requireAdmin);

// Summary of current DB contents + supported backup format version.
router.get('/backup/info', (req, res) => {
  res.json(backupSummary(getDb()));
});

// Download a full backup of the database as a JSON file.
router.get('/backup', (req, res) => {
  const backup = createBackup(getDb());
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="openflow-backup-${date}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

// List backups written by the automatic scheduler (see BACKUP_* env vars).
router.get('/backups', (req, res) => {
  res.json({ backups: listScheduledBackups() });
});

// Download one specific scheduled backup by filename.
router.get('/backups/:filename', (req, res) => {
  try {
    const contents = readScheduledBackup(req.params.filename);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(contents);
  } catch (err) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

// Restore (replace) the database from an uploaded backup. The backup is
// migrated up to the current format before being applied, all inside a single
// transaction — a malformed file leaves existing data untouched.
router.post('/restore', (req, res) => {
  try {
    const db = getDb();
    // Preserve the acting admin so a restore can never lock them out.
    const me = db
      .prepare('SELECT id, email, password_hash, role, created_at FROM users WHERE id = ?')
      .get(req.userId);
    const result = restoreBackup(db, req.body, { preserveUser: me });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Restore failed' });
  }
});

module.exports = router;
