// Operator-supplied links (end-screen redirect, footer links) end up in an
// href or in window.top.location, so a `javascript:` URL would run script on
// the visitor's page. Only web/mail/phone schemes and relative URLs pass.
// Mirrors backend/src/utils/formPayload.js#isSafeUrl, which rejects the rest
// on save; this guards forms saved before that check existed.
const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'];

export function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  // Browsers ignore control characters and whitespace inside a scheme
  // ("java\tscript:"), so strip them before looking at it.
  const cleaned = url.replace(/[\u0000- \u007f]/g, '');
  if (!cleaned) return false;
  const match = cleaned.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match) return true; // relative URL
  return ALLOWED_SCHEMES.includes(match[1].toLowerCase());
}

export function safeUrl(url) {
  return isSafeUrl(url) ? url : '';
}
