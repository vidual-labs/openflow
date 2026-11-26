// Ad tracking data a submission carries: UTM parameters and ad click IDs,
// captured client-side from the landing URL after cookie consent
// (frontend/src/clickIds.js) and posted as `tracking` with the submission.
//
// They are stored flat in submission `metadata` (metadata.gclid has been
// there since click IDs were first captured; the UTMs sit next to it), so
// the Google Ads / Meta integrations and lodgely keep reading the same keys.
// Nothing else from the client's `tracking` object is stored: no free-form
// JSON reaches metadata, and no personal data is added.

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const GOOGLE_CLICK_KEYS = ['gclid', 'gbraid', 'wbraid'];

// What exports show (CSV columns, Google Sheets columns, the webhook's
// `tracking` object): the UTMs and the click IDs. Meta's fbp is a browser
// id rather than a click id, so it stays in metadata for the Conversions API
// and the detail view only.
const TRACKING_EXPORT_KEYS = [...UTM_KEYS, ...GOOGLE_CLICK_KEYS, 'fbc'];

// Meta's click ID (built from ?fbclid=) and browser ID, in the exact
// formats of the _fbc/_fbp cookies — passed to the Conversions API as-is.
const META_FBC_RE = /^fb\.[0-2]\.\d{10,13}\.[A-Za-z0-9_.-]{1,500}$/;
const META_FBP_RE = /^fb\.[0-2]\.\d{10,13}\.[A-Za-z0-9_.-]{1,100}$/;

const UTM_MAX_LENGTH = 200;
const CLICK_ID_MAX_LENGTH = 1000;

// Plain text only: trims, drops control characters and caps the length, so a
// crafted link can't stuff a cell, a header or the admin UI.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

// The client's `tracking` payload → the keys that go into metadata.
function sanitizeTracking(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const key of UTM_KEYS) {
    const value = cleanText(input[key], UTM_MAX_LENGTH);
    if (value) out[key] = value;
  }
  for (const key of GOOGLE_CLICK_KEYS) {
    const value = cleanText(input[key], CLICK_ID_MAX_LENGTH);
    if (value) out[key] = value;
  }
  if (typeof input.fbc === 'string' && META_FBC_RE.test(input.fbc)) out.fbc = input.fbc;
  if (typeof input.fbp === 'string' && META_FBP_RE.test(input.fbp)) out.fbp = input.fbp;
  return out;
}

// Stored metadata → one value per export key (null when not captured).
function trackingFromMetadata(metadata) {
  const m = metadata && typeof metadata === 'object' ? metadata : {};
  const out = {};
  for (const key of TRACKING_EXPORT_KEYS) {
    out[key] = typeof m[key] === 'string' && m[key] ? m[key] : null;
  }
  return out;
}

function hasGoogleAdsClick(metadata) {
  return GOOGLE_CLICK_KEYS.some(key => typeof metadata?.[key] === 'string' && metadata[key]);
}

module.exports = {
  UTM_KEYS,
  GOOGLE_CLICK_KEYS,
  TRACKING_EXPORT_KEYS,
  META_FBC_RE,
  META_FBP_RE,
  sanitizeTracking,
  trackingFromMetadata,
  hasGoogleAdsClick,
};
