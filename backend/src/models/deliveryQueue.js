const { randomUUID: uuid } = require('crypto');
const { runIntegration, checkGoogleAdsRequestStatus } = require('./integrations');
const { decrypt } = require('./encryption');
const logger = require('../utils/logger');

// Backoff schedule (minutes) between delivery attempts. After the last entry
// is exhausted the delivery is marked 'dead' for manual retry — a lead
// should never be silently dropped just because a client's endpoint had a
// bad minute during a campaign.
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 360];
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length;

// An upload the receiving API processes asynchronously (Google Ads Data
// Manager API) is 'processing' until a status check reports the outcome.
// Delays (minutes) before each check; when they run out without a final
// answer the delivery ends as 'unconfirmed'.
const STATUS_CHECK_DELAYS_MINUTES = [5, 15, 60, 240, 720];

// Delivery statuses:
//   pending     – queued, first attempt not finished yet
//   success     – delivered / uploaded
//   processing  – uploaded, waiting for the receiving API's verdict
//   unconfirmed – uploaded, but the API never reported a final status
//   skipped     – nothing to send (e.g. Google Ads without a click ID); no retry
//   retrying    – failed, another attempt is scheduled
//   dead        – failed, retries exhausted
//   failed      – rejected by the receiving API after upload (e.g. invalid gclid); no retry

const MAX_MESSAGE = 2000;
function clip(text) {
  return String(text || '').slice(0, MAX_MESSAGE);
}

// The integration log (integration_delivery_log): one row per attempt or
// status check. Outcome summaries only — see models/integrations.js.
function logEntry(db, { deliveryId, submissionId, kind = 'attempt', status, message, response }) {
  db.prepare(
    `INSERT INTO integration_delivery_log (delivery_id, submission_id, kind, status, message, response)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(deliveryId, submissionId, kind, status, clip(message), response ? JSON.stringify(response) : null);
}

function storedResponse(message, response) {
  return JSON.stringify({ message: clip(message), ...(response || {}) });
}

// SQLite's datetime('now') format (UTC, 'YYYY-MM-DD HH:MM:SS'), so the
// sweep's `next_attempt_at <= datetime('now')` compares like with like. An
// ISO string ('...T...Z') sorts after every same-day datetime('now') value,
// which used to defer each retry to the next calendar day.
function inMinutes(n) {
  return new Date(Date.now() + n * 60000).toISOString().replace('T', ' ').slice(0, 19);
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
  let outcome;
  try {
    outcome = await runIntegration(integration, formId, formTitle, data, steps, { ...metadata, submissionId });
  } catch (err) {
    const message = clip(err.message || err);
    const row = db.prepare('SELECT attempts FROM integration_deliveries WHERE id = ?').get(id);
    const attempts = (row ? row.attempts : 0) + 1;
    if (err && err.skip) {
      db.prepare(
        `UPDATE integration_deliveries
         SET status = 'skipped', attempts = ?, last_error = NULL, response = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(attempts, storedResponse(message), id);
      logEntry(db, { deliveryId: id, submissionId, status: 'skipped', message });
      return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare(
        `UPDATE integration_deliveries
         SET status = 'dead', attempts = ?, last_error = ?, response = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(attempts, message, storedResponse(message), id);
      logEntry(db, { deliveryId: id, submissionId, status: 'dead', message });
      logger.error('integration_delivery_exhausted', { type: integration.type, integrationId: integration.id, error: message });
    } else {
      db.prepare(
        `UPDATE integration_deliveries
         SET status = 'retrying', attempts = ?, last_error = ?, response = ?, next_attempt_at = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(attempts, message, storedResponse(message), inMinutes(RETRY_DELAYS_MINUTES[attempts - 1]), id);
      logEntry(db, { deliveryId: id, submissionId, status: 'retrying', message });
    }
    return;
  }

  const message = (outcome && outcome.message) || 'Delivered';
  const response = outcome && outcome.response;
  if (outcome && outcome.status === 'processing') {
    db.prepare(
      `UPDATE integration_deliveries
       SET status = 'processing', attempts = attempts + 1, checks = 0, last_error = NULL, response = ?,
           next_attempt_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(storedResponse(message, response), inMinutes(STATUS_CHECK_DELAYS_MINUTES[0]), id);
    logEntry(db, { deliveryId: id, submissionId, status: 'processing', message, response });
    return;
  }
  db.prepare(
    `UPDATE integration_deliveries
     SET status = 'success', attempts = attempts + 1, last_error = NULL, response = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(storedResponse(message, response), id);
  logEntry(db, { deliveryId: id, submissionId, status: 'success', message, response });
}

// Follow-up for uploads the receiving API processes asynchronously: asks it
// for the verdict on each 'processing' delivery whose check is due, and
// records 'success', 'failed' (e.g. Google could not decode the gclid) or —
// after the last scheduled check — 'unconfirmed'.
async function processDueStatusChecks(db) {
  const due = db.prepare(
    `SELECT * FROM integration_deliveries
     WHERE status = 'processing' AND next_attempt_at <= datetime('now')`
  ).all();

  for (const row of due) {
    let previous = {};
    try { previous = JSON.parse(row.response || '{}') || {}; } catch { previous = {}; }
    const checks = (row.checks || 0) + 1;
    const integration = db.prepare('SELECT * FROM integrations WHERE id = ?').get(row.integration_id);

    let result;
    if (row.type !== 'google_ads_conversion' || !previous.requestId) {
      result = { status: 'unconfirmed', message: 'No request id to check the upload with' };
    } else if (!integration) {
      result = { status: 'unconfirmed', message: 'Integration was removed before Google reported a result', response: { requestId: previous.requestId } };
    } else {
      try {
        result = await checkGoogleAdsRequestStatus(JSON.parse(decrypt(integration.config)), previous.requestId);
      } catch (err) {
        result = { status: 'processing', message: `Status check failed: ${err.message || err}`, response: { requestId: previous.requestId } };
      }
    }

    if (result.status === 'processing' && checks >= STATUS_CHECK_DELAYS_MINUTES.length) {
      result = { ...result, status: 'unconfirmed', message: `Google reported no final status after ${checks} checks` };
    }

    if (result.status === 'processing') {
      db.prepare(
        `UPDATE integration_deliveries
         SET checks = ?, next_attempt_at = ?, response = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(checks, inMinutes(STATUS_CHECK_DELAYS_MINUTES[checks]), storedResponse(result.message, result.response), row.id);
    } else {
      db.prepare(
        `UPDATE integration_deliveries
         SET status = ?, checks = ?, last_error = ?, response = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(result.status, checks, result.status === 'failed' ? clip(result.message) : null,
        storedResponse(result.message, result.response), row.id);
      if (result.status === 'failed') {
        logger.warn('integration_upload_rejected', { type: row.type, integrationId: row.integration_id, error: result.message });
      }
    }
    logEntry(db, {
      deliveryId: row.id,
      submissionId: row.submission_id,
      kind: 'status_check',
      status: result.status,
      message: result.message,
      response: result.response,
    });
  }
}

// Removes a submission's deliveries and their log (the submission is gone,
// so is the record of where it was sent).
function deleteDeliveriesForSubmission(db, submissionId) {
  db.prepare('DELETE FROM integration_delivery_log WHERE submission_id = ?').run(submissionId);
  db.prepare('DELETE FROM integration_deliveries WHERE submission_id = ?').run(submissionId);
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
      await processDueStatusChecks(db).catch(err => logger.error('delivery_status_check_sweep_failed', { error: err.message }));
      await processDueCalonBookings(db).catch(err => logger.error('calon_booking_sweep_failed', { error: err.message }));
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = {
  enqueueAndAttempt, processDueDeliveries, processDueStatusChecks, retryDelivery, startDeliveryWorker,
  deleteDeliveriesForSubmission, STATUS_CHECK_DELAYS_MINUTES,
};
