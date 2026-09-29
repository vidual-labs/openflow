// Shape checks for the JSON columns of a form. The columns are stringified
// as given, so a `steps: "oops"` or `theme: 3` used to be stored verbatim
// and then crashed every consumer that expects an array/object (the editor,
// the public form, the integration test endpoint).
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Operator-supplied links end up in an href / window.top.location on the
// public form, so a `javascript:` URL would run script in every visitor's
// browser. Mirrors frontend/src/utils/safeUrl.js.
const ALLOWED_URL_SCHEMES = ['http', 'https', 'mailto', 'tel'];

function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  const cleaned = url.replace(/[\u0000-\u0020\u007f]/g, '');
  if (!cleaned) return true; // empty = not set
  const match = cleaned.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match) return true; // relative URL
  return ALLOWED_URL_SCHEMES.includes(match[1].toLowerCase());
}

function validateFormPayload(body) {
  const { title, steps, end_screen, theme } = body || {};
  if (title !== undefined && title !== null) {
    if (typeof title !== 'string') return 'Title must be a string';
    if (!title.trim()) return 'Title is required';
    if (title.length > 200) return 'Title must be at most 200 characters';
  }
  if (steps !== undefined && steps !== null) {
    if (!Array.isArray(steps)) return 'Steps must be an array';
    for (const step of steps) {
      if (!isPlainObject(step) || typeof step.id !== 'string' || !step.id) return 'Every step needs an id';
      if (step.type === 'group') {
        if (!Array.isArray(step.fields) || step.fields.some(f => !isPlainObject(f) || typeof f.id !== 'string' || !f.id)) {
          return 'Every combined step needs a fields array';
        }
      }
    }
  }
  if (end_screen !== undefined && end_screen !== null && !isPlainObject(end_screen)) return 'end_screen must be an object';
  if (theme !== undefined && theme !== null && !isPlainObject(theme)) return 'theme must be an object';
  if (isPlainObject(end_screen) && end_screen.redirectUrl != null && !isSafeUrl(end_screen.redirectUrl)) {
    return 'Redirect URL must be an http(s), mailto: or tel: link';
  }
  if (isPlainObject(theme) && Array.isArray(theme.footerLinks)) {
    for (const link of theme.footerLinks) {
      if (isPlainObject(link) && link.url != null && !isSafeUrl(link.url)) {
        return 'Footer links must be http(s), mailto: or tel: links';
      }
    }
  }
  return null;
}

module.exports = { validateFormPayload, isPlainObject, isSafeUrl };
