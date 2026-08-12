const { getDb } = require('./db');
const logger = require('../utils/logger');

// Records a security-relevant event. Never throws — a logging failure must
// not block the action it's recording (e.g. a login should still succeed
// even if the audit insert somehow fails).
function logAuditEvent({ userId = null, action, target = null, ip = null, details = null }) {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO audit_log (user_id, action, target, ip, details) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, action, target, ip, details ? JSON.stringify(details) : null);
  } catch (err) {
    logger.error('audit_log_write_failed', { error: err.message });
  }
}

function listAuditEvents({ limit = 200 } = {}) {
  const db = getDb();
  const cappedLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return db
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(cappedLimit)
    .map(row => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}

module.exports = { logAuditEvent, listAuditEvents };
