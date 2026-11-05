// Books the slot a respondent picked in a calon-connected Date & Timeslot field
// into that calon instance, when the form is submitted.
//
// The submit route asks calon *before* it stores the submission, so a slot that
// was taken in the meantime (or that calon's rules refuse) goes back to the
// respondent to pick another time. Only when calon can't be asked at all
// (unreachable, 5xx) is the submission stored anyway, with the booking marked
// pending in the submission's metadata; the background worker then retries it
// with the same backoff as integration deliveries, so a calon outage never costs
// a lead. A request calon refuses outright (400/422, or a gating code such as an
// unknown resource) isn't about the slot either: the submission is stored with
// the booking marked failed, instead of sending the respondent back to pick a
// time that can't help.
//
// The booking asks for exactly the shown slot: `start`, plus `end` = start + the
// field's slot length (the `duration_min` its availability was read with).
//
// The booking outcome lives in `metadata.calonBookings[fieldId]`:
//   { status: 'booked', bookingId }                                   — done
//   { status: 'pending', attempts, nextAttemptAt, lastError }          — retrying
//   { status: 'rejected' | 'failed', code?, message?, lastError? }     — gave up
// plus `metadata.calonPending: true` while any of them is pending, which is what
// the retry sweep looks for.

const { flattenFields } = require('../utils/steps');
const { fetchCalonAvailability, submitCalonBooking, localSlotToIso, instantToIso } = require('./calon');
const logger = require('../utils/logger');

const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 360];

class BookingInputError extends Error {}

// The Date & Timeslot fields of a form that book into calon.
function calonBookingFields(steps) {
  return flattenFields(steps).filter(
    f => f && f.type === 'date-timeslot' && f.calon?.enabled && f.calon?.baseUrl
  );
}

function answerOf(data, fieldId) {
  if (!fieldId) return '';
  const v = data[fieldId];
  return v === undefined || v === null ? '' : String(v).trim();
}

// Who is booking. The field editor lets the operator pick the name / email /
// phone fields; left on "automatic", the first Email and Phone fields are used
// and the name comes from the first Short Text field marked with a name
// autofill token. calon requires a name and an email; without a name the email
// stands in for it.
function requesterFor(field, fields, data) {
  const cfg = field.calon || {};
  const firstOfType = (type, pred = () => true) => fields.find(f => f.type === type && pred(f))?.id;
  const nameId = cfg.nameFieldId || firstOfType('text', f => ['name', 'given-name'].includes(f.autocomplete));
  const emailId = cfg.emailFieldId || firstOfType('email');
  const phoneId = cfg.phoneFieldId || firstOfType('phone');

  const email = answerOf(data, emailId);
  if (!email) {
    throw new BookingInputError('An email address is required to book this appointment');
  }
  const phone = answerOf(data, phoneId);
  return {
    name: (answerOf(data, nameId) || email).slice(0, 200),
    email,
    ...(phone ? { phone: phone.slice(0, 64) } : {}),
  };
}

// The instant the answer means. A slot picked from calon's availability carries
// calon's timezone ("2026-09-02 09:30 Europe/Berlin"); one picked from the
// standalone fallback times (calon was unreachable when the step loaded) doesn't,
// so calon is asked for the resource's timezone — which throws if it still can't
// be reached, making the booking a retry like any other outage.
async function startInstant(field, answer) {
  const [date, time, zone] = answer.split(' ');
  let timeZone = zone;
  if (!timeZone) {
    const today = new Date().toISOString().slice(0, 10);
    ({ timezone: timeZone } = await fetchCalonAvailability({
      baseUrl: field.calon.baseUrl,
      resourceSlug: field.calon.resourceSlug,
      from: `${today}T00:00:00Z`,
      to: `${today}T00:00:01Z`,
    }));
    if (!timeZone) throw new Error('calon did not report a timezone');
  }
  try {
    return { start: localSlotToIso(date, time, timeZone), timeZone };
  } catch (err) {
    throw new BookingInputError(`Invalid appointment "${answer}": ${err.message}`);
  }
}

// The slot length the field shows availability for (routes/public.js passes it
// to calon as `duration_min`). Without one, both the availability and the
// booking use the calon resource's default length.
function slotMinutes(field) {
  const minutes = parseInt(field.durationMin, 10);
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

// Ask calon to book one field's answer. Resolves calon's verdict; throws
// BookingInputError for an answer that can never be booked, or any other error
// when calon couldn't be asked.
async function bookField({ field, fields, form, data, submissionId }) {
  const requester = requesterFor(field, fields, data);
  const { start, timeZone } = await startInstant(field, answerOf(data, field.id));
  // Book exactly the slot that was shown: without an `end` calon books its own
  // default length, which differs from the shown slot whenever the field's
  // slot length isn't calon's default.
  const minutes = slotMinutes(field);
  const end = minutes ? instantToIso(Date.parse(start) + minutes * 60000, timeZone) : null;
  return submitCalonBooking({
    baseUrl: field.calon.baseUrl,
    booking: {
      resource_slug: field.calon.resourceSlug || 'default',
      start,
      ...(end ? { end } : {}),
      timezone: timeZone,
      requester,
      subject: `${form.title || 'Booking'}: ${requester.name}`.slice(0, 300),
      metadata: { source: 'openflow', formId: form.id, submissionId, fieldId: field.id },
      source_ref: `openflow:${form.id}:${submissionId}:${field.id}`,
    },
  });
}

function inMinutes(n) {
  return new Date(Date.now() + n * 60000).toISOString();
}

// calon refused the request itself rather than the slot: a 400/422
// (INVALID_REQUEST, its shape) or one of calon's gating decision codes — an
// unusable request, an unknown resource (e.g. the form's resource slug was
// deactivated), a duration that isn't one. Picking another time or asking
// again won't change that, so the respondent isn't sent back to the timeslot
// step: the lead is kept, the booking given up on, and the reason stays with
// it. Only the slot-level codes (taken, outside hours, notice, …) go back to
// the respondent.
const REQUEST_LEVEL_CODES = new Set(['INVALID_REQUEST', 'INVALID_INPUT', 'RESOURCE_UNKNOWN', 'DURATION_NOT_ALLOWED']);

function isRefusedRequest(result) {
  return !result.accepted && REQUEST_LEVEL_CODES.has(result.code);
}

function refusedEntry(result) {
  return { status: 'failed', code: result.code, lastError: String(result.message || '').slice(0, 500) };
}

function pendingEntry(attempts, err) {
  return {
    status: 'pending',
    attempts,
    nextAttemptAt: inMinutes(RETRY_DELAYS_MINUTES[attempts - 1]),
    lastError: String(err.message || err).slice(0, 500),
  };
}

// Book every calon-connected answer of a submission that is about to be stored.
// Resolves { rejected } when calon turned a slot down (nothing was stored; the
// respondent should pick again), else { bookings } — the metadata entries to
// store with the submission.
async function bookSubmission({ form, steps, data, submissionId }) {
  const fields = flattenFields(steps);
  const bookings = {};
  for (const field of calonBookingFields(steps)) {
    if (!answerOf(data, field.id)) continue;
    try {
      const result = await bookField({ field, fields, form, data, submissionId });
      if (isRefusedRequest(result)) {
        logger.error('calon_booking_request_refused', { formId: form.id, fieldId: field.id, error: result.message });
        bookings[field.id] = refusedEntry(result);
        continue;
      }
      if (!result.accepted) {
        return { rejected: { fieldId: field.id, code: result.code, message: result.message } };
      }
      bookings[field.id] = { status: 'booked', bookingId: result.bookingId };
    } catch (err) {
      if (err instanceof BookingInputError) {
        return { rejected: { fieldId: field.id, code: 'INVALID_INPUT', message: err.message } };
      }
      logger.error('calon_booking_deferred', { formId: form.id, fieldId: field.id, error: err.message });
      bookings[field.id] = pendingEntry(1, err);
    }
  }
  return { bookings };
}

// Background sweep: retry the pending bookings whose time has come. calon's
// verdict is final here — there's no respondent left to pick another slot — so a
// rejection is recorded (and logged) rather than retried.
async function processDueCalonBookings(db) {
  const rows = db.prepare(
    `SELECT s.id, s.data, s.metadata, f.id AS form_id, f.title, f.steps
     FROM submissions s JOIN forms f ON f.id = s.form_id
     WHERE json_extract(s.metadata, '$.calonPending') = 1`
  ).all();

  const now = new Date().toISOString();
  for (const row of rows) {
    const metadata = JSON.parse(row.metadata || '{}');
    const data = JSON.parse(row.data || '{}');
    const steps = JSON.parse(row.steps || '[]');
    const fields = flattenFields(steps);
    const form = { id: row.form_id, title: row.title };
    const bookings = metadata.calonBookings || {};

    for (const [fieldId, entry] of Object.entries(bookings)) {
      if (entry.status !== 'pending' || entry.nextAttemptAt > now) continue;
      const field = calonBookingFields(steps).find(f => f.id === fieldId);
      if (!field) {
        bookings[fieldId] = { status: 'failed', lastError: 'The field is no longer connected to calon' };
        continue;
      }
      try {
        const result = await bookField({ field, fields, form, data, submissionId: row.id });
        if (isRefusedRequest(result)) {
          bookings[fieldId] = refusedEntry(result);
          logger.error('calon_booking_request_refused', { formId: form.id, submissionId: row.id, error: result.message });
          continue;
        }
        bookings[fieldId] = result.accepted
          ? { status: 'booked', bookingId: result.bookingId }
          : { status: 'rejected', code: result.code, message: result.message };
        if (!result.accepted) {
          logger.error('calon_booking_rejected_on_retry', { formId: form.id, submissionId: row.id, code: result.code });
        }
      } catch (err) {
        const attempts = (entry.attempts || 0) + 1;
        if (err instanceof BookingInputError || attempts > RETRY_DELAYS_MINUTES.length) {
          bookings[fieldId] = { status: 'failed', attempts, lastError: String(err.message || err).slice(0, 500) };
          logger.error('calon_booking_failed', { formId: form.id, submissionId: row.id, error: err.message });
        } else {
          bookings[fieldId] = pendingEntry(attempts, err);
        }
      }
    }

    metadata.calonBookings = bookings;
    const stillPending = Object.values(bookings).some(b => b.status === 'pending');
    if (stillPending) metadata.calonPending = true;
    else delete metadata.calonPending;
    db.prepare('UPDATE submissions SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), row.id);
  }
}

module.exports = { bookSubmission, processDueCalonBookings, calonBookingFields };
