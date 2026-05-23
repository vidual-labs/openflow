// Subdomain validation for per-form vanity hostnames.
// Reuses the slug character grammar but applies a hostname-specific reserved list.

const { SLUG_REGEX, MIN_LEN, MAX_LEN } = require('./slug');

const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'ftp', 'dashboard',
  'auth', 'login', 'logout', 'status', 'blog', 'docs', 'help',
  'support', 'cdn', 'static', 'assets', 'embed', 'public',
  'mx', 'smtp', 'imap', 'pop', 'pop3', 'ns', 'ns1', 'ns2',
  'autodiscover', 'autoconfig', 'webmail',
]);

function validateSubdomain(sub) {
  if (typeof sub !== 'string') {
    return { ok: false, error: 'Subdomain must be a string' };
  }
  if (sub.length < MIN_LEN) {
    return { ok: false, error: `Subdomain must be at least ${MIN_LEN} characters` };
  }
  if (sub.length > MAX_LEN) {
    return { ok: false, error: `Subdomain must be at most ${MAX_LEN} characters` };
  }
  if (!SLUG_REGEX.test(sub)) {
    return { ok: false, error: 'Subdomain may only contain lowercase letters, digits and hyphens (no leading, trailing, or consecutive hyphens)' };
  }
  if (RESERVED_SUBDOMAINS.has(sub)) {
    return { ok: false, error: `"${sub}" is reserved and cannot be used as a subdomain` };
  }
  return { ok: true };
}

module.exports = { validateSubdomain, RESERVED_SUBDOMAINS };
