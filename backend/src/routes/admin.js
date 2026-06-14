const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { createBackup, backupSummary, restoreBackup } = require('../models/backup');

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

// Restore (replace) the database from an uploaded backup. The backup is
// migrated up to the current format before being applied, all inside a single
// transaction — a malformed file leaves existing data untouched.
router.post('/restore', (req, res) => {
  try {
    const result = restoreBackup(getDb(), req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Restore failed' });
  }
});

module.exports = router;
