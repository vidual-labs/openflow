// Ad click IDs a submission carries for server-side conversion uploads
// (Google Ads, Meta Conversions API), plus the campaign's UTM parameters.
// Callers only use these after cookie consent allows it. The server keeps
// only these keys (backend/src/utils/tracking.js#sanitizeTracking).

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const UTM_MAX_LENGTH = 200;

// utm_source/medium/campaign/term/content from the landing URL, as plain
// trimmed text (the server applies the same rules again).
export function captureUtms(search = window.location.search) {
  const params = new URLSearchParams(search);
  const utms = {};
  UTM_KEYS.forEach(key => {
    // eslint-disable-next-line no-control-regex
    const value = (params.get(key) || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, UTM_MAX_LENGTH);
    if (value) utms[key] = value;
  });
  return utms;
}

// Everything the submission's `tracking` object carries from the URL.
export function captureTracking(search = window.location.search) {
  return { ...captureClickIds(search), ...captureUtms(search) };
}

// Read once from the landing URL. Meta's click ID is sent in the format of
// the Pixel's _fbc cookie, stamped with the time the fbclid was first seen.
export function captureClickIds(search = window.location.search) {
  const params = new URLSearchParams(search);
  const ids = {};
  ['gclid', 'gbraid', 'wbraid'].forEach(key => {
    const value = params.get(key);
    if (value) ids[key] = value;
  });
  const fbclid = params.get('fbclid');
  if (fbclid) ids.fbc = `fb.1.${Date.now()}.${fbclid}`;
  return ids;
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

// At submit time, add Meta's _fbp / _fbc cookies when a Meta Pixel on this
// page has set them (read now rather than on landing: the Pixel usually loads
// only after consent). An _fbc cookie for the same fbclid wins, since it
// holds the original click time; one for an older click doesn't.
export function withMetaCookies(ids) {
  const out = { ...ids };
  const fbp = readCookie('_fbp');
  if (fbp) out.fbp = fbp;
  const fbc = readCookie('_fbc');
  if (fbc) {
    const fbclid = ids.fbc ? ids.fbc.split('.').slice(3).join('.') : '';
    if (!fbclid || fbc.endsWith(`.${fbclid}`) || fbc.includes(`.${fbclid}.`)) out.fbc = fbc;
  }
  return out;
}
