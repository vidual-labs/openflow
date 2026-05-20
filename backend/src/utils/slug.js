// Slug validation for human-editable form URLs.

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'login', 'logout', 'embed', 'f',
  'dashboard', 'forms', 'public', 'assets', 'static',
  'settings', 'auth', 'signup', 'signin', 'register',
  'health', 'robots', 'sitemap', 'favicon', 'www',
]);

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_LEN = 3;
const MAX_LEN = 60;

function validateSlug(slug) {
  if (typeof slug !== 'string') {
    return { ok: false, error: 'Slug must be a string' };
  }
  if (slug.length < MIN_LEN) {
    return { ok: false, error: `Slug must be at least ${MIN_LEN} characters` };
  }
  if (slug.length > MAX_LEN) {
    return { ok: false, error: `Slug must be at most ${MAX_LEN} characters` };
  }
  if (!SLUG_REGEX.test(slug)) {
    return { ok: false, error: 'Slug may only contain lowercase letters, digits and hyphens (no leading, trailing, or consecutive hyphens)' };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: `"${slug}" is reserved and cannot be used` };
  }
  return { ok: true };
}

module.exports = { validateSlug, RESERVED_SLUGS, SLUG_REGEX, MIN_LEN, MAX_LEN };
