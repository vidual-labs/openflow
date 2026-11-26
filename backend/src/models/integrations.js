const nodemailer = require('nodemailer');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;
const { google } = require('googleapis');
const { flattenFields } = require('../utils/steps');
const { formatValue } = require('../utils/formatValue');
const { assertSafeUrl, resolveSafeHost, isLinkLocalOrUnspecified } = require('../utils/ssrf');
const { decrypt } = require('./encryption');
const logger = require('../utils/logger');
const { TRACKING_EXPORT_KEYS, trackingFromMetadata } = require('../utils/tracking');

// Thrown by an integration that has nothing to send for this submission
// (Google Ads without a captured click ID). The delivery queue records it as
// 'skipped' and does not retry — unlike any other error.
class SkipDelivery extends Error {
  constructor(message) {
    super(message);
    this.name = 'SkipDelivery';
    this.skip = true;
  }
}

// Every run<Name>() resolves to an outcome summary for the integration log:
//   { status?: 'processing', message: string, response?: { …short, safe facts } }
// The summary never holds request payloads, webhook/Apps Script response
// bodies (a receiver may echo the lead back) or hashed user data.
function summarize(message, response) {
  return response ? { message, response } : { message };
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

function errorText(text, max = 1000) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ──────────────────────────────────────────
// Run all integrations for a form submission
// ──────────────────────────────────────────

// Run a single integration against a submission. Throws on failure so
// callers (immediate fire-and-forget, or the retrying delivery queue) can
// each decide how to handle/record the error.
async function runIntegration(integration, formId, formTitle, submissionData, steps, metadata = {}) {
  const config = JSON.parse(decrypt(integration.config));
  switch (integration.type) {
    case 'webhook':
      return runWebhook(config, formId, formTitle, submissionData, metadata);
    case 'email':
      return runEmail(config, formId, formTitle, submissionData, steps);
    case 'google_sheets':
      if (config.mode === 'apps_script') {
        return runGoogleSheetsAppsScript(config, formId, formTitle, submissionData, steps, metadata);
      }
      return runGoogleSheets(config, formId, submissionData, steps, metadata);
    case 'google_ads_conversion':
      return runGoogleAdsConversion(config, submissionData, metadata);
    case 'meta_conversion_api':
      return runMetaConversionApi(config, submissionData, steps, metadata);
    default:
      throw new Error(`Unknown integration type: ${integration.type}`);
  }
}

async function runIntegrations(db, formId, formTitle, submissionData, steps, metadata = {}) {
  const integrations = db.prepare(
    'SELECT * FROM integrations WHERE form_id = ? AND enabled = 1'
  ).all(formId);

  const results = [];
  for (const integration of integrations) {
    try {
      const outcome = await runIntegration(integration, formId, formTitle, submissionData, steps, metadata);
      results.push({ id: integration.id, type: integration.type, ok: true, message: outcome?.message });
    } catch (err) {
      logger.error('integration_failed', { type: integration.type, integrationId: integration.id, error: err.message });
      results.push({ id: integration.id, type: integration.type, ok: false, error: err.message });
    }
  }
  return results;
}

// ──────────────────────────────────────────
// Webhook
// ──────────────────────────────────────────

async function runWebhook(config, formId, formTitle, data, metadata = {}) {
  const { url, secret, method = 'POST' } = config;
  if (!url) throw new Error('Webhook URL is required');
  await assertSafeUrl(url);

  // Signature is computed over the exact serialized bytes sent as the body,
  // so a receiver can verify it by HMAC-ing the raw request body it received.
  // (Previously this signed a differently-shaped, differently-timestamped
  // payload than what was actually sent, so no receiver could ever
  // reproduce a matching signature. Fixing this changes the signature value
  // for anyone with a webhook that already worked around the mismatch.)
  // `tracking`: the submission's UTMs and ad click IDs, each null when not
  // captured (utils/tracking.js#TRACKING_EXPORT_KEYS).
  const payload = { event: 'submission', formId, formTitle, data, tracking: trackingFromMetadata(metadata), timestamp: new Date().toISOString() };
  const body = JSON.stringify(payload);

  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    const crypto = require('crypto');
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-OpenFlow-Signature'] = signature;
  }

  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers,
    body,
    signal: AbortSignal.timeout(10000),
    // Don't auto-follow redirects: a validated public URL could redirect to
    // an internal address, bypassing the assertSafeUrl check above.
    redirect: 'manual',
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error('Webhook responded with a redirect, which is not followed for security reasons');
  }
  // Status only: the receiver's response body may echo the lead's data, and
  // this message lands in the integration log.
  if (!res.ok) {
    throw new Error(`Webhook returned HTTP ${res.status}`);
  }
  return summarize(`Delivered (HTTP ${res.status})`, { httpStatus: res.status });
}

// ──────────────────────────────────────────
// Email notification
// ──────────────────────────────────────────

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// The SMTP host is operator-supplied, so it must never reach the cloud
// metadata service or other link-local addresses (SSRF). Private ranges and
// localhost stay allowed by default, because self-hosted installs commonly
// relay through a mail server on their own network (a Postfix container, the
// Docker host, an office relay). SMTP_BLOCK_PRIVATE_HOSTS=true applies the
// same strict check as webhooks instead, and connects to exactly the address
// that was checked (keeping the hostname as TLS servername) so DNS can't
// change underneath it.
async function smtpTarget(host) {
  if (process.env.SMTP_BLOCK_PRIVATE_HOSTS === 'true') {
    try {
      const address = await resolveSafeHost(host);
      return net.isIP(host) ? { host: address } : { host: address, servername: host };
    } catch (err) {
      throw new Error(`SMTP host rejected: ${err.message} (SMTP_BLOCK_PRIVATE_HOSTS is enabled)`);
    }
  }

  let addresses = [];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    // Unresolvable: let nodemailer report its usual connection error.
  }
  if (addresses.some(a => isLinkLocalOrUnspecified(a.address))) {
    throw new Error('SMTP host rejected: it resolves to a link-local/metadata address');
  }
  return { host };
}

async function runEmail(config, formId, formTitle, data, steps) {
  const {
    smtp_host, smtp_port = 587, smtp_user, smtp_pass, smtp_secure = false, to, from, subject,
    contact_links_enabled = true,
    lodgely_link_enabled, lodgely_url, lodgely_button_text,
  } = config;

  if (!smtp_host || !to) throw new Error('SMTP host and recipient are required');

  const transporter = nodemailer.createTransport({
    ...(await smtpTarget(String(smtp_host).trim())),
    port: Number(smtp_port),
    secure: smtp_secure,
    auth: smtp_user ? { user: smtp_user, pass: smtp_pass } : undefined,
  });

  // Build a nice HTML table from submission data (one row per field, groups expanded)
  const rows = flattenFields(steps).map(field => {
    const rawVal = data[field.id];
    // Addresses become one line, uploads "name (size)" — never the base64 blob.
    const val = formatValue(field, rawVal) || '-';

    let valueHtml = escapeHtmlAttr(val);
    if (contact_links_enabled && typeof rawVal === 'string' && rawVal.trim()) {
      if (field.type === 'email') {
        valueHtml = `<a href="mailto:${escapeHtmlAttr(rawVal.trim())}">${valueHtml}</a>`;
      } else if (field.type === 'phone') {
        const telNumber = rawVal.replace(/[^\d+]/g, '');
        if (telNumber) valueHtml = `<a href="tel:${escapeHtmlAttr(telNumber)}">${valueHtml}</a>`;
      }
    }

    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#555;">${escapeHtmlAttr(field.label || field.question || field.id)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${valueHtml}</td></tr>`;
  }).join('');

  const lodgelyLink = lodgely_link_enabled && lodgely_url
    ? `<p style="margin:20px 0;"><a href="${escapeHtmlAttr(lodgely_url)}" style="display:inline-block;padding:10px 18px;background:#6C5CE7;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtmlAttr(lodgely_button_text || 'Open in lodgely')}</a></p>`
    : '';

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#6C5CE7;">New Submission: ${escapeHtmlAttr(formTitle)}</h2>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        ${rows}
      </table>
      ${lodgelyLink}
      <p style="color:#999;font-size:12px;">Sent by OpenFlow</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: from || `OpenFlow <${smtp_user || 'noreply@openflow.local'}>`,
    to,
    subject: subject || `New submission: ${formTitle}`,
    html,
  });
  // The SMTP server's reply line ("250 2.0.0 Ok: queued as …") — no addresses.
  const smtpReply = errorText(info && info.response, 200);
  return summarize('Sent', smtpReply ? { smtp: smtpReply } : undefined);
}

// ──────────────────────────────────────────
// Google Sheets (Simple — via Apps Script)
// ──────────────────────────────────────────

async function runGoogleSheetsAppsScript(config, formId, formTitle, data, steps, metadata = {}) {
  const { apps_script_url } = config;
  if (!apps_script_url) throw new Error('Apps Script URL is required');
  await assertSafeUrl(apps_script_url);
  // Apps Script web apps legitimately 302 to script.googleusercontent.com to
  // serve the execution result, so (unlike the generic webhook) we can't
  // just refuse to follow redirects — instead restrict the *initial* host to
  // Google's own domain, which is the only legitimate target for this
  // integration and can't be pointed at an internal address.
  const host = new URL(apps_script_url).hostname;
  if (host !== 'script.google.com') {
    throw new Error('Apps Script URL must be on script.google.com');
  }

  const payload = {
    formId,
    formTitle,
    data,
    fields: flattenFields(steps).map(s => ({ id: s.id, key: s.key, label: s.label || s.question || s.id })),
    tracking: trackingFromMetadata(metadata),
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(apps_script_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Apps Script returned ${res.status}`);
  }
  return summarize(`Delivered (HTTP ${res.status})`, { httpStatus: res.status });
}

// ──────────────────────────────────────────
// Google Sheets (Service Account)
// ──────────────────────────────────────────

async function runGoogleSheets(config, formId, data, steps, metadata = {}) {
  const { credentials_json, spreadsheet_id, sheet_name = 'Sheet1' } = config;

  if (!credentials_json || !spreadsheet_id) {
    throw new Error('Google credentials and spreadsheet ID are required');
  }

  let credentials;
  try {
    credentials = typeof credentials_json === 'string' ? JSON.parse(credentials_json) : credentials_json;
  } catch {
    throw new Error('Invalid credentials JSON');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Check if headers exist, if not write them
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheet_id,
    range: `${sheet_name}!1:1`,
  });

  const fields = flattenFields(steps);
  const existingHeader = (headerRes.data.values && headerRes.data.values[0]) || [];
  // Append the submission row (one cell per field, groups expanded)
  const row = [
    new Date().toISOString(),
    // Sheets rejects cells over 50 000 chars, so a base64 upload must never
    // be written raw; formatValue turns it into "name (size)".
    ...fields.map(s => formatValue(s, data[s.id])),
  ];

  // Tracking columns (UTMs, click IDs) go after the fields, matched by their
  // header name. A sheet created before they existed gets the missing header
  // cells added to the right of its header row; existing columns stay put.
  const tracking = trackingFromMetadata(metadata);
  if (existingHeader.length === 0) {
    const headers = ['Timestamp', ...fields.map(s => s.label || s.question || s.id), ...TRACKING_EXPORT_KEYS];
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet_id,
      range: `${sheet_name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
    TRACKING_EXPORT_KEYS.forEach(key => row.push(tracking[key] || ''));
  } else {
    const header = [...existingHeader];
    const fieldEnd = row.length;
    let headerChanged = false;
    for (const key of TRACKING_EXPORT_KEYS) {
      // Only look right of the field columns, so a field labelled like a
      // tracking key never swallows its value.
      let col = header.indexOf(key, fieldEnd);
      if (col === -1) {
        col = Math.max(header.length, fieldEnd);
        while (header.length < col) header.push('');
        header[col] = key;
        headerChanged = true;
      }
      while (row.length < col) row.push('');
      row[col] = tracking[key] || '';
    }
    if (headerChanged) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet_id,
        range: `${sheet_name}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [header] },
      });
    }
  }

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheet_id,
    range: `${sheet_name}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  const updatedRange = appendRes?.data?.updates?.updatedRange;
  return summarize(updatedRange ? `Row appended (${updatedRange})` : 'Row appended', updatedRange ? { updatedRange } : undefined);
}

// ──────────────────────────────────────────
// Google Ads (server-side conversion upload via the Data Manager API)
// ──────────────────────────────────────────

// Exchanges the pasted long-lived refresh token for a short-lived OAuth
// access token. Reuses the googleapis dependency already installed for the
// Google Sheets service-account integration rather than hand-rolling the
// OAuth2 refresh-token grant.
async function getGoogleAdsAccessToken(config) {
  const { client_id, client_secret, refresh_token } = config;
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error('Google Ads client ID, client secret and refresh token are required');
  }
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials({ refresh_token });
  const { token } = await oauth2Client.getAccessToken();
  if (!token) throw new Error('Failed to obtain a Google Ads access token from the refresh token');
  return token;
}

async function runGoogleAdsConversion(config, data, metadata) {
  const { customer_id, login_customer_id, conversion_action_id, currency_code = 'USD', default_value, value_field_id } = config;
  if (!customer_id || !conversion_action_id) {
    throw new Error('Google Ads customer ID and conversion action ID are required');
  }

  const gclid = metadata?.gclid;
  const gbraid = metadata?.gbraid;
  const wbraid = metadata?.wbraid;
  if (!gclid && !gbraid && !wbraid) {
    throw new SkipDelivery('No Google Ads click ID (gclid/gbraid/wbraid) was captured for this submission');
  }

  const accessToken = await getGoogleAdsAccessToken(config);

  // The UI stores '' when no default is set; Number('') would upload value 0.
  let conversionValue = default_value !== undefined && default_value !== '' && default_value !== null ? Number(default_value) : undefined;
  if (value_field_id) {
    const raw = data[value_field_id];
    const parsed = Number(raw);
    if (raw !== undefined && raw !== null && String(raw).trim() !== '' && !Number.isNaN(parsed)) conversionValue = parsed;
  }

  const adIdentifiers = {};
  if (gclid) adIdentifiers.gclid = gclid;
  if (gbraid) adIdentifiers.gbraid = gbraid;
  if (wbraid) adIdentifiers.wbraid = wbraid;

  const destination = {
    reference: 'd1',
    operatingAccount: { accountId: String(customer_id).replace(/-/g, ''), accountType: 'GOOGLE_ADS' },
    productDestinationId: String(conversion_action_id),
  };
  if (login_customer_id) {
    destination.loginAccount = { accountId: String(login_customer_id).replace(/-/g, ''), accountType: 'GOOGLE_ADS' };
  }

  const event = {
    destinationReferences: ['d1'],
    transactionId: `${gclid || gbraid || wbraid}:${metadata?.submittedAt || new Date().toISOString()}`,
    eventTimestamp: metadata?.submittedAt || new Date().toISOString(),
    eventSource: 'WEB',
    adIdentifiers,
  };
  if (conversionValue !== undefined) event.conversionValue = conversionValue;
  if (currency_code) event.currency = currency_code;

  const res = await fetch('https://datamanager.googleapis.com/v1/events:ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ destinations: [destination], events: [event] }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Google Ads Data Manager API returned ${res.status}: ${errorText(await res.text().catch(() => ''))}`);
  }

  // The Data Manager API processes events asynchronously: it answers with a
  // requestId, and whether the conversion was accepted (or e.g. the gclid
  // could not be decoded) is only known later via requestStatus:retrieve —
  // the delivery queue polls that (checkGoogleAdsRequestStatus below).
  const body = await readJson(res);
  const requestId = body && typeof body.requestId === 'string' ? body.requestId : '';
  const response = {};
  if (requestId) response.requestId = requestId;
  if (Array.isArray(body?.fieldWarnings) && body.fieldWarnings.length) response.fieldWarnings = body.fieldWarnings.length;
  if (!requestId) return summarize('Uploaded', Object.keys(response).length ? response : undefined);
  return { status: 'processing', message: 'Uploaded, waiting for Google to process it', response };
}

// 'PROCESSING_ERROR_REASON_INVALID_GCLID' → 'invalid gclid'
function describeGoogleReason(reason) {
  return String(reason || '')
    .replace(/^PROCESSING_(ERROR|WARNING)_REASON_/, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim() || 'unknown reason';
}

// Looks up the outcome of an earlier events:ingest request. Resolves to
//   { status: 'success' | 'failed' | 'processing', message, response }
// and throws only when the lookup itself fails (network, auth).
async function checkGoogleAdsRequestStatus(config, requestId) {
  const accessToken = await getGoogleAdsAccessToken(config);
  const res = await fetch(
    `https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) {
    throw new Error(`Google Ads request status lookup returned ${res.status}: ${errorText(await res.text().catch(() => ''), 500)}`);
  }
  const body = await readJson(res);
  const perDestination = Array.isArray(body?.requestStatusPerDestination) ? body.requestStatusPerDestination : [];
  const statuses = perDestination.map(d => d && d.requestStatus).filter(Boolean);
  const reasons = [];
  for (const d of perDestination) {
    for (const c of d?.errorInfo?.errorCounts || []) {
      if (c && c.reason && !reasons.includes(c.reason)) reasons.push(String(c.reason));
    }
  }
  const response = { requestId };
  if (statuses.length) response.requestStatus = statuses.join(',');
  if (reasons.length) response.errorReasons = reasons;

  if (statuses.some(st => st === 'FAILED' || st === 'PARTIAL_SUCCESS')) {
    const why = reasons.length ? reasons.map(describeGoogleReason).join(', ') : 'no reason given';
    return { status: 'failed', message: `Google rejected the conversion: ${why}`, response };
  }
  if (statuses.length && statuses.every(st => st === 'SUCCESS')) {
    return { status: 'success', message: 'Uploaded and processed by Google', response };
  }
  return { status: 'processing', message: 'Google is still processing the upload', response };
}

// Validates Google Ads credentials without uploading a conversion — used by
// the integration "Test" button, since a synthetic test submission has no
// real gclid and would either fail or (worse) upload garbage to a real
// Google Ads account.
async function testGoogleAdsCredentials(config) {
  await getGoogleAdsAccessToken(config);
}

const META_GRAPH_API_VERSION = 'v21.0';

// The access token goes in a header rather than the ?access_token= query
// string, which proxies and request logs tend to record.
function metaAuthHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function runMetaConversionApi(config, data, steps, metadata) {
  const { pixel_id, access_token, currency_code = 'USD', default_value, value_field_id, test_event_code } = config;
  if (!pixel_id || !access_token) {
    throw new Error('Meta Pixel ID and access token are required');
  }

  // No client-side Pixel is required — matching relies on the IP/user agent
  // captured on every submission, plus hashed email/phone when the form
  // collects them (Meta requires user data to be hashed with SHA-256).
  const userData = {};
  if (metadata?.ip) userData.client_ip_address = metadata.ip;
  if (metadata?.userAgent) userData.client_user_agent = metadata.userAgent;
  // Click ID (from ?fbclid=) and browser ID, captured client-side after
  // cookie consent. Meta wants these unhashed.
  if (metadata?.fbc) userData.fbc = metadata.fbc;
  if (metadata?.fbp) userData.fbp = metadata.fbp;
  flattenFields(steps).forEach(field => {
    const raw = data[field.id];
    if (raw === undefined || raw === null || String(raw).trim() === '') return;
    if (field.type === 'email') {
      userData.em = [crypto.createHash('sha256').update(String(raw).trim().toLowerCase()).digest('hex')];
    } else if (field.type === 'phone') {
      userData.ph = [crypto.createHash('sha256').update(String(raw).replace(/[^0-9]/g, '')).digest('hex')];
    }
  });

  // Same rules as Google Ads above: an unset default is '' (or null), and an
  // empty answer in the value field falls back to the default — Number('')
  // and Number(null) are 0, which used to report the lead as worth nothing.
  let value = default_value !== undefined && default_value !== '' && default_value !== null ? Number(default_value) : undefined;
  if (value_field_id) {
    const raw = data[value_field_id];
    const parsed = Number(raw);
    if (raw !== undefined && raw !== null && String(raw).trim() !== '' && !Number.isNaN(parsed)) value = parsed;
  }

  // event_id is the submission id: stable across the delivery queue's
  // retries, and handed to the browser (dataLayer / postMessage) so a Meta
  // Pixel firing the same Lead with eventID = it is deduplicated against this
  // one. Only the integration test path has no submission.
  const event = {
    event_name: 'Lead',
    event_time: Math.floor(new Date(metadata?.submittedAt || Date.now()).getTime() / 1000),
    event_id: metadata?.submissionId || `test-${crypto.randomUUID()}`,
    action_source: 'website',
    user_data: userData,
  };
  if (value !== undefined) event.custom_data = { value, currency: currency_code };

  const payload = { data: [event] };
  if (test_event_code) payload.test_event_code = test_event_code;

  const res = await fetch(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(pixel_id)}/events`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...metaAuthHeader(access_token) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) {
    throw new Error(`Meta Conversions API returned ${res.status}: ${errorText(await res.text().catch(() => ''))}`);
  }
  // Only Meta's counters and trace id are kept — never the hashed user_data.
  const body = await readJson(res);
  const response = {};
  if (body && body.events_received !== undefined) response.eventsReceived = Number(body.events_received);
  if (body && typeof body.fbtrace_id === 'string') response.fbtraceId = body.fbtrace_id;
  if (test_event_code) response.testEvent = true;
  const received = response.eventsReceived !== undefined ? ` (${response.eventsReceived} event${response.eventsReceived === 1 ? '' : 's'} received)` : '';
  return summarize(`Sent to Meta${received}${test_event_code ? ' as a test event' : ''}`, Object.keys(response).length ? response : undefined);
}

// Validates the Pixel ID and access token without sending an event — used by
// the integration "Test" button when no test_event_code is configured, since
// a synthetic test submission has no real lead and would otherwise post a
// fake (but real, uncounted-as-test) Lead event to the advertiser's account.
async function testMetaConversionApiCredentials(config) {
  const { pixel_id, access_token } = config;
  if (!pixel_id || !access_token) {
    throw new Error('Meta Pixel ID and access token are required');
  }
  const res = await fetch(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(pixel_id)}?fields=id`,
    { headers: metaAuthHeader(access_token), signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) {
    throw new Error(`Meta Graph API returned ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

module.exports = {
  runIntegrations, runIntegration, testGoogleAdsCredentials, testMetaConversionApiCredentials, smtpTarget,
  checkGoogleAdsRequestStatus, SkipDelivery,
};
