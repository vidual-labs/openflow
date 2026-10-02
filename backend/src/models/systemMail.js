const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// OpenFlow's own outgoing mail (login codes, security notices), configured by
// the operator through SMTP_* environment variables. Separate from the
// per-form "email" integration, whose SMTP settings belong to a form owner.
//
//   SMTP_HOST          required to enable system mail
//   SMTP_PORT          default 587 (465 implies SMTP_SECURE)
//   SMTP_SECURE        true = implicit TLS (port 465); otherwise STARTTLS
//   SMTP_REQUIRE_TLS   default true: refuse to send over an unencrypted
//                      connection when SMTP_SECURE is off. Set false only for
//                      a relay on a trusted local network.
//   SMTP_USER/SMTP_PASS  optional credentials
//   SMTP_FROM          sender, e.g. "OpenFlow <no-reply@example.com>"
//                      (defaults to SMTP_USER when that is an address)

function flag(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function mailConfig(env = process.env) {
  const host = (env.SMTP_HOST || '').trim();
  if (!host) return null;
  const port = Number.parseInt(env.SMTP_PORT, 10) || 587;
  const secure = flag(env.SMTP_SECURE, port === 465);
  const user = (env.SMTP_USER || '').trim();
  const from = (env.SMTP_FROM || '').trim() || (user.includes('@') ? user : '');
  if (!from) return null;
  return {
    host,
    port,
    secure,
    requireTLS: !secure && flag(env.SMTP_REQUIRE_TLS, true),
    auth: user ? { user, pass: env.SMTP_PASS || '' } : undefined,
    from,
  };
}

function isMailConfigured() {
  return mailConfig() !== null;
}

// Tests swap the transport for an in-memory one (with SMTP_HOST/SMTP_FROM set).
let transportOverride = null;
function setTransportForTests(transport) {
  transportOverride = transport;
}

function createTransport() {
  if (transportOverride) return transportOverride;
  const cfg = mailConfig();
  // Short timeouts: a code is sent while the user waits on the login screen,
  // so a dead SMTP server must fail fast instead of hanging the request.
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTLS,
    auth: cfg.auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Sends a short security mail. `lines` are plain-text paragraphs; `code` (if
// given) is shown large in the HTML part. Throws when mail isn't configured or
// the SMTP server refuses, so callers decide how to surface it.
async function sendSystemMail({ to, subject, lines, code = null }) {
  const cfg = mailConfig();
  if (!cfg) throw new Error('System e-mail is not configured (SMTP_HOST / SMTP_FROM)');
  const transport = createTransport();
  const text = (code ? [lines[0], '', `    ${code}`, '', ...lines.slice(1)] : lines).join('\n') + '\n\n— OpenFlow\n';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:520px">`
    + `<p>${escapeHtml(lines[0])}</p>`
    + (code ? `<p style="font-size:30px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,Consolas,monospace;margin:20px 0">${escapeHtml(code)}</p>` : '')
    + lines.slice(1).map(l => `<p>${escapeHtml(l)}</p>`).join('')
    + '<p style="color:#6b7280;font-size:13px">— OpenFlow</p></div>';
  await transport.sendMail({ from: cfg.from, to, subject, text, html });
}

// Best-effort notice (new sign-in, lockout, 2FA turned off): never throws,
// never delays the request that triggered it.
function sendSecurityNotice(to, subject, lines) {
  if (!isMailConfigured()) return;
  sendSystemMail({ to, subject, lines }).catch((err) => {
    logger.warn('security_notice_failed', { subject, error: err.message });
  });
}

// Logged once at boot so a typo in SMTP_* shows up in `docker compose logs`
// right away rather than as a failed login code later.
async function verifyMailAtBoot() {
  const cfg = mailConfig();
  if (!cfg) {
    if ((process.env.SMTP_HOST || '').trim()) {
      logger.warn('system_mail_incomplete', { hint: 'SMTP_HOST is set but there is no sender address: set SMTP_FROM (or an e-mail address as SMTP_USER). Two-factor login stays unavailable until then.' });
    } else {
      logger.info('system_mail_not_configured', { hint: 'Set SMTP_HOST, SMTP_FROM (and SMTP_USER/SMTP_PASS) to enable two-factor login codes and security e-mails.' });
    }
    return;
  }
  try {
    await createTransport().verify();
    logger.info('system_mail_ready', { host: cfg.host, port: cfg.port, secure: cfg.secure });
  } catch (err) {
    logger.error('system_mail_unreachable', { host: cfg.host, port: cfg.port, error: err.message, hint: 'Two-factor login codes cannot be delivered until this is fixed.' });
  }
}

module.exports = { mailConfig, isMailConfigured, sendSystemMail, sendSecurityNotice, verifyMailAtBoot, setTransportForTests };
