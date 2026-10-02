// Browser security headers.
//
// Two kinds of pages come out of the same SPA bundle:
//  - the admin app (login, dashboard, editor, …) — locked down: a strict
//    Content-Security-Policy (only this origin's scripts, so an injected
//    <script> or inline handler can't run) and no framing (clickjacking of
//    the login page or the editor);
//  - public form pages (/f/:slug, /embed/:slug, per-form subdomains) — left
//    without a CSP or frame restrictions, because they load the operator's
//    GTM container / Meta Pixel and /embed is meant to be iframed anywhere.
//
// Every response gets nosniff and a referrer policy, and HSTS when the request
// arrived over HTTPS (directly, or via a trusted proxy — see TRUST_PROXY).
// HSTS is sent without includeSubDomains, so it can't affect other hosts
// under the operator's domain.

const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React inline style attributes and the form renderer's theme <style>.
  "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' data: https:",
  // Branding logo, form logos/images and icon-select images can be any URL.
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-src 'self' https:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function isPublicFormPath(path) {
  return path.startsWith('/f/') || path.startsWith('/embed/') || path.startsWith('/api/public/');
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  // A per-form subdomain only ever serves the public form (the subdomain
  // middleware sets req.subdomainForm and 404s admin paths there).
  if (req.subdomainForm || isPublicFormPath(req.path)) return next();

  res.setHeader('X-Frame-Options', 'DENY');
  // Static assets (JS/CSS/images) don't need a CSP of their own; it is the
  // HTML document whose policy counts. API responses get it too — harmless,
  // and it keeps a JSON response opened directly from ever running script.
  res.setHeader('Content-Security-Policy', ADMIN_CSP);
  next();
}

module.exports = { securityHeaders, ADMIN_CSP };
