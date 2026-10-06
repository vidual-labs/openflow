const { Router } = require('express');
const { getDb, ensureFormFieldKeys } = require('../models/db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { createBackup, backupSummary, restoreBackup } = require('../models/backup');
const { listScheduledBackups, readScheduledBackup } = require('../models/backupScheduler');
const { logAuditEvent, listAuditEvents } = require('../models/auditLog');
const { publicSettings, isEnvManaged, readStoredSettings, writeStoredSettings, clearStoredSettings, verifyConfig, sendSystemMail } = require('../models/systemMail');
const { asyncHandler } = require('../middleware/errorHandler');
const { isTwoFactorDisabledByOperator } = require('../models/twoFactor');
const { checkRateLimit } = require('../models/rateLimit');

const router = Router();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Everything under /api/admin is admin-only.
router.use(authMiddleware, requireAdmin);

function twoFactorUserCount() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE twofa_enabled = 1').get().n;
}

// System e-mail (login codes, security notices). SMTP_* in the environment
// wins and makes these read-only; otherwise admins configure it here. The
// password is write-only, like integration secrets.
router.get('/mail', (req, res) => {
  res.json({ ...publicSettings(), twoFactorUsers: twoFactorUserCount(), twoFactorDisabledByOperator: isTwoFactorDisabledByOperator() });
});

// Saves the UI settings after checking that the server accepts them (connect
// + log in), so a typo can't silently break login codes. `skipVerify` saves
// anyway, e.g. while the mail server is briefly down.
router.put('/mail', asyncHandler(async (req, res) => {
  if (isEnvManaged()) {
    return res.status(409).json({ error: 'System e-mail is managed by the server environment (SMTP_* variables) and can only be changed there.' });
  }
  const body = req.body || {};
  const host = typeof body.host === 'string' ? body.host.trim() : '';
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const user = typeof body.user === 'string' ? body.user.trim() : '';
  const port = Number.parseInt(body.port, 10);
  if (!host || host.length > 253 || !/^[a-zA-Z0-9.\-:[\]]+$/.test(host)) {
    return res.status(400).json({ error: 'Enter a valid SMTP host name' });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Enter a valid port (1–65535)' });
  }
  if (!from && !user.includes('@')) {
    return res.status(400).json({ error: 'Enter a sender address (or use an e-mail address as the user name)' });
  }
  if (from.length > 320 || user.length > 320 || (from && !/@/.test(from))) {
    return res.status(400).json({ error: 'The sender must contain an e-mail address, e.g. OpenFlow <no-reply@example.com>' });
  }

  // Password: omitted keeps the stored one, '' / null clears it.
  const previous = readStoredSettings() || {};
  let pass = previous.pass || '';
  if (Object.prototype.hasOwnProperty.call(body, 'password')) {
    if (body.password === null || body.password === '') pass = '';
    else if (typeof body.password === 'string') pass = body.password;
  }

  const settings = { host, port, secure: !!body.secure, requireTLS: body.requireTLS !== false, user, pass, from };
  if (!body.skipVerify) {
    try {
      await verifyConfig(settings);
    } catch (err) {
      return res.status(422).json({ error: `The mail server did not accept these settings: ${err.message}`, code: 'verify_failed' });
    }
  }
  writeStoredSettings(settings);
  logAuditEvent({ userId: req.userId, action: 'mail_settings_updated', target: host, ip: clientIp(req), details: { port, user: user || null, verified: !body.skipVerify } });
  res.json({ ok: true, ...publicSettings() });
}));

router.delete('/mail', (req, res) => {
  if (isEnvManaged()) {
    return res.status(409).json({ error: 'System e-mail is managed by the server environment (SMTP_* variables) and can only be changed there.' });
  }
  clearStoredSettings();
  logAuditEvent({ userId: req.userId, action: 'mail_settings_removed', ip: clientIp(req) });
  res.json({ ok: true, twoFactorUsers: twoFactorUserCount(), ...publicSettings() });
});

// Sends a test message to the requesting admin's own address, so SMTP_*
// can be checked before anyone relies on e-mailed login codes.
router.post('/mail/test', asyncHandler(async (req, res) => {
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
}));

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
    // A backup taken before 0.46 carries forms without field keys.
    ensureFormFieldKeys(db);
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
