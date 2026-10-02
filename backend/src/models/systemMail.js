const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// OpenFlow's own outgoing mail (login codes, security notices). Separate from
// the per-form "email" integration, whose SMTP settings belong to a form owner.
//
// Two sources, in this order:
//  1. SMTP_* environment variables. When SMTP_HOST is set they win and the
//     admin UI only shows them read-only — an out-of-band config a wrong UI
//     save can never break (2FA users depend on it to sign in).
//       SMTP_HOST          enables env-managed mail
//       SMTP_PORT          default 587 (465 implies SMTP_SECURE)
//       SMTP_SECURE        true = implicit TLS (port 465); otherwise STARTTLS
//       SMTP_REQUIRE_TLS   default true: refuse to send unencrypted when
//                          SMTP_SECURE is off. false only for a trusted relay.
//       SMTP_USER/SMTP_PASS  optional credentials
//       SMTP_FROM          sender, e.g. "OpenFlow <no-reply@example.com>"
//                          (defaults to SMTP_USER when that is an address)
//  2. Settings → System e-mail in the admin UI, stored as the `smtp` row of
//     site_settings, encrypted with ENCRYPTION_KEY (models/encryption.js). The
//     password is write-only: the API reports whether one is set, never it.

const SETTINGS_KEY = 'smtp';

function flag(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

// Normalises either source into the shape nodemailer needs, or null when it
// isn't usable (no host, or no sender address).
function buildConfig({ host, port, secure, requireTLS, user, pass, from }, source) {
  host = String(host || '').trim();
  if (!host) return null;
  port = Number.parseInt(port, 10) || 587;
  const isSecure = flag(secure, port === 465);
  user = String(user || '').trim();
  from = String(from || '').trim() || (user.includes('@') ? user : '');
  if (!from) return null;
  return {
    host,
    port,
    secure: isSecure,
    requireTLS: !isSecure && flag(requireTLS, true),
    auth: user ? { user, pass: pass || '' } : undefined,
    from,
    source,
  };
}

function isEnvManaged(env = process.env) {
  return !!(env.SMTP_HOST || '').trim();
}

function envConfig(env = process.env) {
  return buildConfig({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, requireTLS: env.SMTP_REQUIRE_TLS,
    user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM,
  }, 'env');
}

// The settings saved in the admin UI (decrypted), or null.
function readStoredSettings() {
  try {
    const { getDb } = require('./db');
    const row = getDb().prepare('SELECT value FROM site_settings WHERE key = ?').get(SETTINGS_KEY);
    if (!row) return null;
    const { decrypt, isEncrypted } = require('./encryption');
    const parsed = JSON.parse(row.value);
    const plain = typeof parsed === 'string' && isEncrypted(parsed) ? decrypt(parsed) : parsed;
    return typeof plain === 'string' ? JSON.parse(plain) : plain;
  } catch (err) {
    logger.error('system_mail_settings_unreadable', { error: err.message, hint: 'The SMTP settings saved in the admin UI could not be decrypted — was ENCRYPTION_KEY changed? Re-enter them under Settings → System e-mail.' });
    return null;
  }
}

function writeStoredSettings(settings) {
  const { getDb } = require('./db');
  const { encrypt } = require('./encryption');
  const value = JSON.stringify(encrypt(JSON.stringify(settings)));
  getDb().prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SETTINGS_KEY, value);
}

function clearStoredSettings() {
  const { getDb } = require('./db');
  getDb().prepare('DELETE FROM site_settings WHERE key = ?').run(SETTINGS_KEY);
}

// The effective config: environment first, then the admin UI.
function mailConfig(env = process.env) {
  if (isEnvManaged(env)) return envConfig(env);
  const stored = readStoredSettings();
  return stored ? buildConfig(stored, 'ui') : null;
}

function isMailConfigured() {
  return mailConfig() !== null;
}

// What the admin UI may show: everything but the password.
function publicSettings() {
  const envManaged = isEnvManaged();
  const raw = envManaged
    ? { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_SECURE, requireTLS: process.env.SMTP_REQUIRE_TLS, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM }
    : (readStoredSettings() || {});
  const cfg = envManaged ? envConfig() : (raw.host ? buildConfig(raw, 'ui') : null);
  const port = Number.parseInt(raw.port, 10) || 587;
  return {
    source: envManaged ? 'env' : (raw.host ? 'ui' : null),
    locked: envManaged,
    configured: !!cfg,
    settings: {
      host: String(raw.host || '').trim(),
      port,
      secure: flag(raw.secure, port === 465),
      requireTLS: flag(raw.requireTLS, true),
      user: String(raw.user || '').trim(),
      from: String(raw.from || '').trim(),
      passwordSet: !!raw.pass,
    },
  };
}

// Tests swap the transport for an in-memory one (with SMTP_HOST/SMTP_FROM set).
let transportOverride = null;
function setTransportForTests(transport) {
  transportOverride = transport;
}

async function createTransport(cfg) {
  if (transportOverride) return transportOverride;
  // A host typed into the admin UI gets the same SSRF guard as the per-form
  // e-mail integration (never the cloud metadata service). The operator's own
  // SMTP_HOST is trusted as is.
  const target = cfg.source === 'ui' ? await require('./integrations').smtpTarget(cfg.host) : { host: cfg.host };
  // Short timeouts: a code is sent while the user waits on the login screen,
  // so a dead SMTP server must fail fast instead of hanging the request.
  return nodemailer.createTransport({
    ...target,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTLS,
    auth: cfg.auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

// Connects and authenticates with a candidate config without sending; throws
// with the server's reason. Used before the admin UI saves new settings.
async function verifyConfig(settings) {
  const cfg = buildConfig(settings, 'ui');
  if (!cfg) throw new Error('Host and a sender address are required');
  const transport = await createTransport(cfg);
  await transport.verify();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Sends a short security mail. `lines` are plain-text paragraphs; `code` (if
// given) is shown large in the HTML part. Throws when mail isn't configured or
// the SMTP server refuses, so callers decide how to surface it.
async function sendSystemMail({ to, subject, lines, code = null }) {
  const cfg = mailConfig();
  if (!cfg) throw new Error('System e-mail is not configured (Settings → System e-mail, or SMTP_HOST / SMTP_FROM)');
  const transport = await createTransport(cfg);
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
    if (isEnvManaged()) {
      logger.warn('system_mail_incomplete', { hint: 'SMTP_HOST is set but there is no sender address: set SMTP_FROM (or an e-mail address as SMTP_USER). Two-factor login stays unavailable until then.' });
    } else {
      logger.info('system_mail_not_configured', { hint: 'Configure it under Settings → System e-mail (or set SMTP_HOST, SMTP_FROM, SMTP_USER/SMTP_PASS) to enable two-factor login codes and security e-mails.' });
    }
    return;
  }
  try {
    await (await createTransport(cfg)).verify();
    logger.info('system_mail_ready', { host: cfg.host, port: cfg.port, secure: cfg.secure, source: cfg.source });
  } catch (err) {
    logger.error('system_mail_unreachable', { host: cfg.host, port: cfg.port, source: cfg.source, error: err.message, hint: 'Two-factor login codes cannot be delivered until this is fixed.' });
  }
}

module.exports = {
  mailConfig,
  isMailConfigured,
  isEnvManaged,
  publicSettings,
  readStoredSettings,
  writeStoredSettings,
  clearStoredSettings,
  verifyConfig,
  sendSystemMail,
  sendSecurityNotice,
  verifyMailAtBoot,
  setTransportForTests,
};
