const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { getDb } = require('../models/db');
const { checkRateLimit } = require('../models/rateLimit');
const { randomUUID: uuid } = require('crypto');
const { flattenFields } = require('../utils/steps');
const { visibleSteps } = require('../utils/conditions');
const logger = require('../utils/logger');

const router = Router();

// Meta's _fbc / _fbp cookie formats: fb.<subdomain index>.<creation time ms>.<fbclid | random id>
// (the last part may carry a dot-separated suffix in newer Pixel versions).
const META_FBC_RE = /^fb\.[0-2]\.\d{10,13}\.[A-Za-z0-9_.-]{1,500}$/;
const META_FBP_RE = /^fb\.[0-2]\.\d{10,13}\.[A-Za-z0-9_.-]{1,100}$/;

// req.ip already honours Express's 'trust proxy' setting (index.js enables
// it, as `trust proxy: 1`, only when fronted by a real reverse proxy), which
// takes the *last* X-Forwarded-For hop — the one the proxy itself appended.
// Reading the first entry instead would let any client behind the proxy
// pick its own IP, defeating the submit/track throttles and storing a
// spoofed address in submission metadata.
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Get published form by slug (public)
router.get('/form/:slug', (req, res) => {
  const db = getDb();
  let form = db.prepare(
    'SELECT id, title, slug, steps, end_screen, theme, gtm_id FROM forms WHERE slug = ? AND published = 1'
  ).get(req.params.slug);

  // Fall back to slug history so previously shared URLs keep working after a rename.
  // The response still carries the canonical slug — the client should swap the URL.
  if (!form) {
    const historic = db.prepare('SELECT form_id FROM slug_history WHERE old_slug = ?').get(req.params.slug);
    if (historic) {
      form = db.prepare(
        'SELECT id, title, slug, steps, end_screen, theme, gtm_id FROM forms WHERE id = ? AND published = 1'
      ).get(historic.form_id);
    }
  }

  if (!form) return res.status(404).json({ error: 'Form not found' });

  try {
    form.steps = JSON.parse(form.steps);
    form.end_screen = JSON.parse(form.end_screen);
    form.theme = JSON.parse(form.theme);
  } catch {
    return res.status(500).json({ error: 'Form data is corrupted' });
  }
  res.json({ form });
});

// Read live availability from the calon instance a `date-timeslot` field is
// connected to (public — anyone who can load the form can already see the
// field, and calon's own availability read is itself unauthenticated).
router.get('/form/:slug/availability', asyncHandler(async (req, res) => {
  const ip = clientIp(req);
  const allowed = checkRateLimit(`availability:${ip}`, 20, 60);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }

  const fieldId = req.query.fieldId;
  if (!fieldId || typeof fieldId !== 'string') {
    return res.status(400).json({ error: 'fieldId is required' });
  }

  const db = getDb();
  let form = db.prepare('SELECT id, steps FROM forms WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!form) {
    const historic = db.prepare('SELECT form_id FROM slug_history WHERE old_slug = ?').get(req.params.slug);
    if (historic) {
      form = db.prepare('SELECT id, steps FROM forms WHERE id = ? AND published = 1').get(historic.form_id);
    }
  }
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const steps = JSON.parse(form.steps);
  const field = flattenFields(steps).find(f => f.id === fieldId);
  if (!field || field.type !== 'date-timeslot' || !field.calon?.enabled || !field.calon?.baseUrl) {
    return res.status(404).json({ error: 'No calon-connected date/timeslot field with that id' });
  }

  const rangeDays = Math.min(Math.max(parseInt(field.rangeDays, 10) || 14, 1), 31);
  const now = new Date();
  const to = new Date(now.getTime() + rangeDays * 24 * 60 * 60 * 1000);

  try {
    const { fetchCalonAvailability } = require('../models/calon');
    const { timezone, slots } = await fetchCalonAvailability({
      baseUrl: field.calon.baseUrl,
      resourceSlug: field.calon.resourceSlug,
      from: now.toISOString(),
      to: to.toISOString(),
      durationMin: field.durationMin,
    });
    res.json({ timezone, slots });
  } catch (err) {
    logger.error('calon_availability_fetch_failed', { formId: form.id, fieldId, error: err.message });
    res.status(502).json({ error: 'Could not reach calon' });
  }
}));

// Submit form response (public)
router.post('/form/:slug/submit', asyncHandler(async (req, res) => {
  // Rate limit: 10 submissions per IP per minute
  const ip = clientIp(req);
  const allowed = checkRateLimit(`submit:${ip}`, 10, 60);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many submissions, please try again later' });
  }

  const db = getDb();
  let form = db.prepare('SELECT id, title, steps, end_screen FROM forms WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!form) {
    const historic = db.prepare('SELECT form_id FROM slug_history WHERE old_slug = ?').get(req.params.slug);
    if (historic) {
      form = db.prepare('SELECT id, title, steps, end_screen FROM forms WHERE id = ? AND published = 1').get(historic.form_id);
    }
  }
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const allSteps = JSON.parse(form.steps);
  const { data } = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid submission data' });
  }

  // Conditional logic: a step hidden by a previous answer is neither
  // validated (a required question the visitor never saw must not block
  // the submission) nor stored (a stale answer from before the visitor
  // changed their mind is not part of what they submitted).
  const steps = visibleSteps(allSteps, data);
  const visibleFieldIds = new Set(flattenFields(steps).map(f => f.id));
  // `_consent` is the only non-field key the renderer sends; anything else a
  // client adds would otherwise be stored unvalidated and forwarded to every
  // webhook.
  for (const key of Object.keys(data)) {
    if (!visibleFieldIds.has(key) && key !== '_consent') delete data[key];
  }

  // GDPR consent is enforced here too, not only in the renderer: a form that
  // asks for consent must never store a submission without it.
  let endScreen = {};
  try { endScreen = JSON.parse(form.end_screen || '{}') || {}; } catch { endScreen = {}; }
  if (endScreen.consentEnabled) {
    if (data._consent !== true) {
      return res.status(400).json({ error: 'Consent is required', code: 'consent_required' });
    }
  } else {
    delete data._consent;
  }

  // Basic validation. Combined ("group") steps validate each sub-field, and may
  // additionally require that at least one of their fields is answered.
  // Mirrors the renderer's notion of "answered": an empty array (multiple
  // choice with nothing ticked), an address without street/postal/city or a
  // bare `{}` would otherwise pass as `String({}) === '[object Object]'`.
  const isEmpty = (v) => {
    if (v === undefined || v === null || v === false) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.values(v).every(part => part == null || String(part).trim() === '');
    return false;
  };
  // Type checks the client also runs; anyone posting to the API directly
  // gets the same answer the form would have given.
  const PHONE_RE = /^\+?[\d\s().\/-]{3,30}$/;
  const fieldTypeError = (field, v) => {
    if (v === undefined || v === null || v === '') return null;
    if (field.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) return `Field "${field.label || field.id}" must be a number`;
      const min = Number(field.min), max = Number(field.max);
      if (field.min !== undefined && field.min !== null && field.min !== '' && Number.isFinite(min) && n < min) return `Field "${field.label || field.id}" must be at least ${min}`;
      if (field.max !== undefined && field.max !== null && field.max !== '' && Number.isFinite(max) && n > max) return `Field "${field.label || field.id}" must be at most ${max}`;
    }
    if (field.type === 'email' && typeof v === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) {
      return `Field "${field.label || field.id}" must be a valid email address`;
    }
    if (field.type === 'phone' && typeof v === 'string' && !(PHONE_RE.test(v.trim()) && (v.match(/\d/g) || []).length >= 3)) {
      return `Field "${field.label || field.id}" must be a valid phone number`;
    }
    return null;
  };
  const isFieldEmpty = (field, v) => {
    if (isEmpty(v)) return true;
    if (field.type === 'address') {
      const c = (v && typeof v === 'object') ? v : {};
      return ['street', 'postalCode', 'city'].some(k => isEmpty(c[k]));
    }
    return false;
  };
  for (const step of steps) {
    if (step.type === 'group' && Array.isArray(step.fields)) {
      for (const field of step.fields) {
        if (field.required && isFieldEmpty(field, data[field.id])) {
          return res.status(400).json({ error: `Field "${field.label || field.id}" is required` });
        }
        const typeError = fieldTypeError(field, data[field.id]);
        if (typeError) return res.status(400).json({ error: typeError });
      }
      if (step.requireOne && !step.fields.some(field => !isFieldEmpty(field, data[field.id]))) {
        return res.status(400).json({ error: 'Please answer at least one question in this step' });
      }
    } else {
      if (step.required && isFieldEmpty(step, data[step.id])) {
        return res.status(400).json({ error: `Field "${step.label || step.id}" is required` });
      }
      const typeError = fieldTypeError(step, data[step.id]);
      if (typeError) return res.status(400).json({ error: typeError });
    }
  }

  const id = uuid();

  // A calon-connected Date & Timeslot answer is booked into calon *before* the
  // submission is stored, so a slot that is no longer free goes straight back to
  // the respondent instead of producing a lead with a booking that never happened.
  // (models/calonBooking.js; calon being unreachable stores the submission and
  // retries the booking in the background instead.)
  const { bookSubmission } = require('../models/calonBooking');
  const booking = await bookSubmission({ form, steps, data, submissionId: id });
  if (booking.rejected) {
    const { fieldId, code, message } = booking.rejected;
    logger.info('calon_booking_rejected', { formId: form.id, fieldId, code });
    return res.status(409).json({
      error: code === 'INVALID_INPUT' ? message : 'This time is no longer available. Please pick another one.',
      code: code === 'INVALID_INPUT' ? 'calon_invalid_input' : 'slot_unavailable',
      fieldId,
    });
  }

  const metadata = {
    ip,
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer || '',
    submittedAt: new Date().toISOString(),
  };

  // Whitelist the ad click IDs the client may have captured from the
  // landing URL (see FormView/EmbedView) — don't spread arbitrary
  // client-supplied JSON into stored metadata.
  const tracking = req.body.tracking;
  if (tracking && typeof tracking === 'object') {
    ['gclid', 'gbraid', 'wbraid'].forEach(key => {
      if (typeof tracking[key] === 'string' && tracking[key]) metadata[key] = tracking[key];
    });
    // Meta's click ID (built from ?fbclid=) and browser ID, in the exact
    // formats of the _fbc/_fbp cookies — passed through to the Conversions
    // API as-is, so anything else is dropped rather than stored.
    if (typeof tracking.fbc === 'string' && META_FBC_RE.test(tracking.fbc)) metadata.fbc = tracking.fbc;
    if (typeof tracking.fbp === 'string' && META_FBP_RE.test(tracking.fbp)) metadata.fbp = tracking.fbp;
  }

  if (Object.keys(booking.bookings).length > 0) {
    metadata.calonBookings = booking.bookings;
    if (Object.values(booking.bookings).some(b => b.status === 'pending')) metadata.calonPending = true;
  }

  db.prepare('INSERT INTO submissions (id, form_id, data, metadata) VALUES (?, ?, ?, ?)').run(
    id, form.id, JSON.stringify(data), JSON.stringify(metadata)
  );

  res.status(201).json({ ok: true, id });

  // Deliver to integrations async (don't block response). Each delivery is
  // persisted first, so a failure (client webhook down, SMTP hiccup) retries
  // with backoff instead of silently losing the lead.
  const { enqueueAndAttempt } = require('../models/deliveryQueue');
  // Integrations get the *configured* steps: a Sheets row must keep the same
  // columns whether or not a conditional step was shown to this respondent.
  enqueueAndAttempt(db, form.id, form.title, id, data, allSteps, metadata).catch(err => {
    logger.error('integration_delivery_failed', { formId: form.id, error: err.message });
  });
}));

// Track analytics event (public, rate limited)
router.post('/track', (req, res) => {
  const ip = clientIp(req);
  const allowed = checkRateLimit(`track:${ip}`, 100, 60);
  if (!allowed) return res.status(429).json({ error: 'Rate limited' });

  const { formId, event, sessionId, stepIndex, stepId } = req.body;
  if (!formId || !event) return res.status(400).json({ error: 'Missing formId or event' });

  const validEvents = ['view', 'start', 'step', 'complete', 'drop'];
  if (!validEvents.includes(event)) return res.status(400).json({ error: 'Invalid event type' });

  const db = getDb();
  const formExists = db.prepare('SELECT id FROM forms WHERE id = ?').get(formId);
  if (!formExists) return res.status(404).json({ error: 'Form not found' });

  try {
    db.prepare(
      'INSERT INTO analytics_events (form_id, event, session_id, step_index, step_id) VALUES (?, ?, ?, ?, ?)'
    ).run(formId, event, sessionId || null, stepIndex ?? null, stepId || null);
  } catch (err) {
    logger.error('analytics_event_insert_failed', { formId, error: err.message });
  }

  res.json({ ok: true });
});

module.exports = router;
