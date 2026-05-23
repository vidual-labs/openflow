// Subdomain routing middleware.
//
// When OPENFLOW_PRIMARY_HOST is set and a request arrives on a non-www
// subdomain of it (e.g. acme.openflow.example.com), this middleware:
//   1. Resolves the form claiming that subdomain (published only).
//   2. Attaches it to req.subdomainForm so the SPA-serving catch-all can
//      inject the form slug into index.html.
//   3. Blocks admin APIs (return 404 JSON) so the form-only host can't reach
//      authenticated endpoints even if a client tries.
//   4. Lets static assets + /api/public/* + /f/* + /embed/* pass through.
//
// Requests to the primary host (or any host that doesn't match) are
// untouched, so existing deployments continue to behave exactly as before.

const { getDb } = require('../models/db');

// Paths that, on a subdomain, return 404 because they would expose admin UI
// or admin APIs. The catch-all SPA serves index.html for anything not in this
// list; React Router on the client only has FormView / EmbedView in scope for
// subdomain visits, so untracked client routes fall back to FormView anyway.
const ADMIN_PATH_PREFIXES = [
  '/api/auth',
  '/api/forms',
  '/api/submissions',
  '/api/integrations',
  '/api/analytics',
  '/api/settings',
];

function isAdminPath(p) {
  for (const prefix of ADMIN_PATH_PREFIXES) {
    if (p === prefix || p.startsWith(prefix + '/')) return true;
  }
  return false;
}

function extractSubdomain(hostname, primaryHost) {
  if (!hostname || !primaryHost) return null;
  const h = hostname.toLowerCase();
  const p = primaryHost.toLowerCase();
  if (h === p) return null;
  const suffix = '.' + p;
  if (!h.endsWith(suffix)) return null;
  const prefix = h.slice(0, h.length - suffix.length);
  if (!prefix) return null;
  // Permit only a single label (no nested subdomains).
  if (prefix.includes('.')) return null;
  return prefix;
}

function createSubdomainMiddleware() {
  return function subdomainMiddleware(req, res, next) {
    const primaryHost = process.env.OPENFLOW_PRIMARY_HOST;
    if (!primaryHost) return next();

    const sub = extractSubdomain(req.hostname, primaryHost);
    if (!sub || sub === 'www') return next();

    let form;
    try {
      form = getDb().prepare(
        'SELECT id, slug, title FROM forms WHERE subdomain = ? AND published = 1'
      ).get(sub);
    } catch {
      // DB lookup failure shouldn't take down the primary host — fall through.
      return next();
    }

    if (!form) {
      // Subdomain looks like ours but no form claims it. Show a clean 404
      // rather than the admin landing page.
      return res.status(404).type('text/plain').send('Form not found');
    }

    req.subdomainForm = form;

    if (req.path.startsWith('/api/') && isAdminPath(req.path)) {
      // Admin APIs don't exist on per-form subdomains.
      return res.status(404).json({ error: 'Not available on this hostname' });
    }

    // Force any direct request for the raw index file through the catch-all
    // (which injects window.__OPENFLOW_HOST_FORM__), rather than letting the
    // static middleware serve the un-injected HTML.
    if (req.path === '/index.html') {
      req.url = '/' + req.url.slice('/index.html'.length);
    }

    return next();
  };
}

module.exports = { createSubdomainMiddleware, extractSubdomain, isAdminPath };
