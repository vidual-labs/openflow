const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { flattenFields } = require('../utils/steps');
const { formatValue } = require('../utils/formatValue');
const { TRACKING_EXPORT_KEYS, GOOGLE_CLICK_KEYS, trackingFromMetadata } = require('../utils/tracking');
const { deleteDeliveriesForSubmission } = require('../models/deliveryQueue');

const router = Router();

router.use(authMiddleware);

// Optional response filters (?utm_source=…&utm_medium=…&utm_campaign=…&google_ads_click=yes|no),
// shared by the list and the CSV export. A UTM filter of NONE matches
// responses that carry no value for it. Without any filter the queries — and
// the list's response shape the lodgely connector reads — are unchanged.
const FILTER_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'];
const NONE = '__none__';

function submissionFilters(query) {
  const clauses = [];
  const params = [];
  for (const key of FILTER_UTM_KEYS) {
    const value = query[key];
    if (typeof value !== 'string' || value === '') continue;
    if (value === NONE) {
      clauses.push(`COALESCE(json_extract(metadata, '$.${key}'), '') = ''`);
    } else {
      clauses.push(`json_extract(metadata, '$.${key}') = ?`);
      params.push(value.slice(0, 200));
    }
  }
  const anyGoogleClick = '(' + GOOGLE_CLICK_KEYS.map(k => `COALESCE(json_extract(metadata, '$.${k}'), '') != ''`).join(' OR ') + ')';
  if (query.google_ads_click === 'yes') clauses.push(anyGoogleClick);
  else if (query.google_ads_click === 'no') clauses.push(`NOT ${anyGoogleClick}`);
  return { sql: clauses.map(c => ` AND ${c}`).join(''), params };
}

// How a delivery's status reads in the CSV export and the admin UI.
const DELIVERY_STATUS_LABELS = {
  pending: 'pending',
  success: 'uploaded',
  processing: 'uploaded (awaiting confirmation)',
  unconfirmed: 'uploaded (unconfirmed)',
  skipped: 'skipped',
  retrying: 'failed (retrying)',
  dead: 'failed',
  failed: 'failed',
};
const INTEGRATION_LABELS = {
  webhook: 'Webhook',
  email: 'Email',
  google_sheets: 'Google Sheets',
  google_ads_conversion: 'Google Ads',
  meta_conversion_api: 'Meta CAPI',
};

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function deliveryCell(delivery) {
  if (!delivery) return '';
  const label = DELIVERY_STATUS_LABELS[delivery.status] || delivery.status;
  if (['skipped', 'retrying', 'dead', 'failed', 'unconfirmed'].includes(delivery.status)) {
    const message = parseJson(delivery.response || '{}', {})?.message || delivery.last_error || '';
    return message ? `${label}: ${message}` : label;
  }
  return label;
}

// List submissions for a form
router.get('/:formId', (req, res) => {
  const db = getDb();
  // Verify ownership
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const filter = submissionFilters(req.query);
  const total = db.prepare(`SELECT COUNT(*) as count FROM submissions WHERE form_id = ?${filter.sql}`)
    .get(req.params.formId, ...filter.params).count;
  // created_at has second precision; rowid breaks ties so submissions from
  // the same second are newest-first too (the lodgely connector pages on it).
  const submissions = db.prepare(
    `SELECT * FROM submissions WHERE form_id = ?${filter.sql} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
  ).all(req.params.formId, ...filter.params, limit, offset);

  submissions.forEach(s => {
    s.data = JSON.parse(s.data);
    s.metadata = JSON.parse(s.metadata);
  });

  res.json({ submissions, total, page, limit });
});

// The distinct UTM values of a form's responses, for the response filters.
router.get('/:formId/filters', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const values = {};
  for (const key of FILTER_UTM_KEYS) {
    values[key] = db.prepare(
      `SELECT DISTINCT json_extract(metadata, '$.${key}') AS v FROM submissions
       WHERE form_id = ? AND COALESCE(json_extract(metadata, '$.${key}'), '') != ''
       ORDER BY v LIMIT 200`
    ).all(req.params.formId).map(r => String(r.v));
  }
  res.json({ values });
});

// Export submissions as CSV
router.get('/:formId/export', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT * FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const filter = submissionFilters(req.query);
  const submissions = db.prepare(
    `SELECT * FROM submissions WHERE form_id = ?${filter.sql} ORDER BY created_at DESC, rowid DESC`
  ).all(req.params.formId, ...filter.params);

  // One status column per integration of the form, e.g. "Integration: Google Ads".
  const integrations = db.prepare('SELECT id, type FROM integrations WHERE form_id = ? ORDER BY created_at, rowid').all(form.id);
  const seen = {};
  const integrationHeaders = integrations.map(i => {
    const label = INTEGRATION_LABELS[i.type] || i.type;
    seen[label] = (seen[label] || 0) + 1;
    return `Integration: ${label}${seen[label] > 1 ? ` #${seen[label]}` : ''}`;
  });
  const deliveries = {};
  db.prepare('SELECT submission_id, integration_id, status, response, last_error FROM integration_deliveries WHERE form_id = ? ORDER BY created_at')
    .all(form.id)
    .forEach(d => { deliveries[`${d.submission_id}:${d.integration_id}`] = d; });

  // Flatten combined "group" steps to one column per underlying field.
  const fields = flattenFields(JSON.parse(form.steps));
  const headers = ['Submitted At', ...fields.map(f => f.label || f.question || f.id), ...TRACKING_EXPORT_KEYS, ...integrationHeaders];
  const rows = submissions.map(s => {
    const data = JSON.parse(s.data);
    const tracking = trackingFromMetadata(parseJson(s.metadata || '{}', {}));
    return [
      s.created_at,
      ...fields.map(f => formatValue(f, data[f.id])),
      ...TRACKING_EXPORT_KEYS.map(k => tracking[k] || ''),
      ...integrations.map(i => deliveryCell(deliveries[`${s.id}:${i.id}`])),
    ];
  });

  // Neutralize CSV/DDE formula injection: if a cell starts with a character
  // spreadsheet apps treat as a formula prefix, prepend a single quote so it
  // opens as text instead of executing when the exported file is opened.
  const neutralizeFormula = (cell) => {
    const str = String(cell);
    return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  };

  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${neutralizeFormula(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${form.slug}-submissions.csv"`);
  res.send(csv);
});

// The integration log of one submission: each integration it was sent to,
// its current status and every attempt / status check, oldest first.
router.get('/:formId/:submissionId/integrations', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const submission = db.prepare('SELECT id FROM submissions WHERE id = ? AND form_id = ?').get(req.params.submissionId, form.id);
  if (!submission) return res.status(404).json({ error: 'Submission not found' });

  const log = db.prepare(
    'SELECT delivery_id, kind, status, message, response, created_at FROM integration_delivery_log WHERE submission_id = ? ORDER BY id'
  ).all(submission.id);
  const deliveries = db.prepare(
    `SELECT id, integration_id, type, status, attempts, checks, last_error, response, next_attempt_at, created_at, updated_at
     FROM integration_deliveries WHERE submission_id = ? AND form_id = ? ORDER BY created_at, rowid`
  ).all(submission.id, form.id).map(d => ({
    ...d,
    response: parseJson(d.response || 'null', null),
    log: log.filter(l => l.delivery_id === d.id).map(l => ({
      kind: l.kind,
      status: l.status,
      message: l.message,
      response: parseJson(l.response || 'null', null),
      created_at: l.created_at,
    })),
  }));
  res.json({ deliveries });
});

// Delete a submission (and its integration log)
router.delete('/:formId/:submissionId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const remove = db.transaction(() => {
    const result = db.prepare('DELETE FROM submissions WHERE id = ? AND form_id = ?').run(req.params.submissionId, req.params.formId);
    if (result.changes > 0) deleteDeliveriesForSubmission(db, req.params.submissionId);
    return result.changes;
  });
  if (remove() === 0) return res.status(404).json({ error: 'Submission not found' });
  res.json({ ok: true });
});

module.exports = router;
