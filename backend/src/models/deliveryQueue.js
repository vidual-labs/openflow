const { randomUUID: uuid } = require('crypto');
const { runIntegration } = require('./integrations');
const logger = require('../utils/logger');

// Backoff schedule (minutes) between delivery attempts. After the last entry
// is exhausted the delivery is marked 'dead' for manual retry — a lead
// should never be silently dropped just because a client's endpoint had a
// bad minute during a campaign.
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 360];
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length;

function inMinutes(n) {
  return new Date(Date.now() + n * 60000).toISOString();
}

// Enqueue one delivery row per enabled integration and attempt each
// immediately, so the common (success) case has no added latency. Failures
// are persisted with a next_attempt_at so the background worker retries
// them instead of losing the submission.
async function enqueueAndAttempt(db, formId, formTitle, submissionId, data, steps, metadata = {}) {
  const integrations = db.prepare(
    'SELECT * FROM integrations WHERE form_id = ? AND enabled = 1'
  ).all(formId);

  for (const integration of integrations) {
    const deliveryId = uuid();
    db.prepare(
      `INSERT INTO integration_deliveries (id, form_id, integration_id, submission_id, type, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(deliveryId, formId, integration.id, submissionId, integration.type);

    await attemptDelivery(db, { id: deliveryId, integration, formId, formTitle, submissionId, data, steps, metadata });
  }
}

// The submission id rides along in metadata (it isn't stored there) so
// integrations can key on it — e.g. Meta's event_id, which must stay the same
// across retries so Meta counts a re-sent lead once.
async function attemptDelivery(db, { id, integration, formId, formTitle, submissionId, data, steps, metadata = {} }) {
  try {
    await runIntegration(integration, formId, formTitle, data, steps, { ...metadata, submissionId });
    db.prepare(
      `UPDATE integration_deliveries SET status = 'success', updated_at = datetime('now') WHERE id = ?`
    ).run(id);
  } catch (err) {
    const row = db.prepare('SELECT attempts FROM integration_deliveries WHERE id = ?').get(id);
    const attempts = (row ? row.attempts : 0) + 1;
    const message = String(err.message || err).slice(0, 2000);
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare(
        `UPDATE integration_deliveries
         SET status = 'dead', attempts = ?, last_error = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(attempts, message, id);
      logger.error('integration_delivery_exhausted', { type: integration.type, integrationId: integration.id, error: message });
    } else {
      db.prepare(
        `UPDATE integration_deliveries
         SET status = 'retrying', attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(attempts, message, inMinutes(RETRY_DELAYS_MINUTES[attempts - 1]), id);
    }
  }
}

// Background sweep: re-attempt any delivery whose retry time has arrived.
// Re-parses the submission's stored data/steps so this works across process
// restarts (the queue only lives in SQLite, not in memory).
async function processDueDeliveries(db) {
  const due = db.prepare(
    `SELECT d.*, s.data AS submission_data, s.metadata AS submission_metadata, f.title AS form_title, f.steps AS form_steps
     FROM integration_deliveries d
     JOIN submissions s ON s.id = d.submission_id
     JOIN forms f ON f.id = d.form_id
     WHERE d.status = 'retrying' AND d.next_attempt_at <= datetime('now')`
  ).all();

  for (const row of due) {
    const integration = db.prepare('SELECT * FROM integrations WHERE id = ?').get(row.integration_id);
    if (!integration || !integration.enabled) {
      db.prepare(
        `UPDATE integration_deliveries SET status = 'dead', last_error = 'Integration was disabled or removed', updated_at = datetime('now') WHERE id = ?`
      ).run(row.id);
      continue;
    }
    await attemptDelivery(db, {
      id: row.id,
      integration,
      formId: row.form_id,
      formTitle: row.form_title,
      submissionId: row.submission_id,
      data: JSON.parse(row.submission_data),
      steps: JSON.parse(row.form_steps),
      metadata: JSON.parse(row.submission_metadata || '{}'),
    });
  }
}

// Manual retry of a dead (or still-retrying) delivery, e.g. after the client
// fixes their webhook endpoint.
async function retryDelivery(db, deliveryId) {
  const row = db.prepare(
    `SELECT d.*, s.data AS submission_data, s.metadata AS submission_metadata, f.title AS form_title, f.steps AS form_steps
     FROM integration_deliveries d
     JOIN submissions s ON s.id = d.submission_id
     JOIN forms f ON f.id = d.form_id
     WHERE d.id = ?`
  ).get(deliveryId);
  if (!row) throw new Error('Delivery not found');

  const integration = db.prepare('SELECT * FROM integrations WHERE id = ?').get(row.integration_id);
  if (!integration) throw new Error('Integration no longer exists');

  await attemptDelivery(db, {
    id: row.id,
    integration,
    formId: row.form_id,
    formTitle: row.form_title,
    submissionId: row.submission_id,
    data: JSON.parse(row.submission_data),
    steps: JSON.parse(row.form_steps),
    metadata: JSON.parse(row.submission_metadata || '{}'),
  });
  return db.prepare('SELECT * FROM integration_deliveries WHERE id = ?').get(deliveryId);
}

function startDeliveryWorker(db, intervalMs = 30000) {
  // Pending calon bookings (models/calonBooking.js) ride on the same sweep. A
  // sweep still running (slow endpoints) skips the next tick rather than
  // attempting the same rows twice.
  const { processDueCalonBookings } = require('./calonBooking');
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processDueDeliveries(db).catch(err => logger.error('delivery_worker_sweep_failed', { error: err.message }));
      await processDueCalonBookings(db).catch(err => logger.error('calon_booking_sweep_failed', { error: err.message }));
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { enqueueAndAttempt, processDueDeliveries, retryDelivery, startDeliveryWorker };
