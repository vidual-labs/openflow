const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { createBackup, backupSummary, restoreBackup } = require('../models/backup');
const { listScheduledBackups, readScheduledBackup } = require('../models/backupScheduler');
const { logAuditEvent, listAuditEvents } = require('../models/auditLog');
const { mailConfig, sendSystemMail } = require('../models/systemMail');
const { isTwoFactorDisabledByOperator } = require('../models/twoFactor');
const { checkRateLimit } = require('../models/rateLimit');

const router = Router();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Everything under /api/admin is admin-only.
router.use(authMiddleware, requireAdmin);

// Status of the operator's outgoing mail (SMTP_* env), shown on Settings.
router.get('/mail', (req, res) => {
  const cfg = mailConfig();
  res.json({
    configured: !!cfg,
    host: cfg ? cfg.host : null,
    port: cfg ? cfg.port : null,
    from: cfg ? cfg.from : null,
    twoFactorDisabledByOperator: isTwoFactorDisabledByOperator(),
  });
});

// Sends a test message to the requesting admin's own address, so SMTP_*
// can be checked before anyone relies on e-mailed login codes.
router.post('/mail/test', async (req, res) => {
  if (!checkRateLimit(`mail-test:${req.userId}`, 5, 15 * 60)) {
    return res.status(429).json({ error: 'Too many test e-mails. Try again in a few minutes.' });
  }
  const me = getDb().prepare('SELECT email FROM users WHERE id = ?').get(req.userId);
  if (!me) return res.status(404).json({ error: 'User not found' });
  try {
    await sendSystemMail({
      to: me.email,
      subject: 'OpenFlow test e-mail',
      lines: ['This is a test e-mail from your OpenFlow server. Outgoing mail works, so two-factor login codes can be delivered.'],
    });
    res.json({ ok: true, to: me.email });
  } catch (err) {
    res.status(502).json({ error: `Sending failed: ${err.message}` });
  }
});

// Recent security-relevant events (logins, user/admin changes, backup/restore).
router.get('/audit-log', (req, res) => {
  res.json({ events: listAuditEvents({ limit: req.query.limit }) });
});

// Summary of current DB contents + supported backup format version.
router.get('/backup/info', (req, res) => {
  res.json(backupSummary(getDb()));
});

// Download a full backup of the database as a JSON file.
router.get('/backup', (req, res) => {
  const backup = createBackup(getDb());
  const date = new Date().toISOString().slice(0, 10);
  logAuditEvent({ userId: req.userId, action: 'backup_downloaded', ip: clientIp(req) });
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
      .prepare('SELECT id, email, password_hash, role, created_at, token_version, twofa_enabled FROM users WHERE id = ?')
      .get(req.userId);
    const result = restoreBackup(db, req.body, { preserveUser: me });
    // The restored users may have other passwords and roles than the ones
    // their open sessions were granted under: sign everyone else out.
    db.transaction(() => {
      db.prepare('DELETE FROM sessions WHERE user_id != ?').run(req.userId);
      db.prepare('DELETE FROM trusted_devices WHERE user_id != ?').run(req.userId);
      db.prepare('DELETE FROM auth_challenges').run();
      db.prepare('DELETE FROM login_failures').run();
    })();
    logAuditEvent({ userId: req.userId, action: 'backup_restored', ip: clientIp(req), details: result });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Restore failed' });
  }
});

module.exports = router;
