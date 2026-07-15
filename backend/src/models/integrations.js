const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { flattenFields } = require('../utils/steps');
const { assertSafeUrl } = require('../utils/ssrf');

// ──────────────────────────────────────────
// Run all integrations for a form submission
// ──────────────────────────────────────────

// Run a single integration against a submission. Throws on failure so
// callers (immediate fire-and-forget, or the retrying delivery queue) can
// each decide how to handle/record the error.
async function runIntegration(integration, formId, formTitle, submissionData, steps, metadata = {}) {
  const config = JSON.parse(integration.config);
  switch (integration.type) {
    case 'webhook':
      return runWebhook(config, formId, formTitle, submissionData);
    case 'email':
      return runEmail(config, formId, formTitle, submissionData, steps);
    case 'google_sheets':
      if (config.mode === 'apps_script') {
        return runGoogleSheetsAppsScript(config, formId, formTitle, submissionData, steps);
      }
      return runGoogleSheets(config, formId, submissionData, steps);
    case 'google_ads_conversion':
      return runGoogleAdsConversion(config, submissionData, metadata);
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
      await runIntegration(integration, formId, formTitle, submissionData, steps, metadata);
      results.push({ id: integration.id, type: integration.type, ok: true });
    } catch (err) {
      console.error(`Integration ${integration.type}/${integration.id} failed:`, err.message);
      results.push({ id: integration.id, type: integration.type, ok: false, error: err.message });
    }
  }
  return results;
}

// ──────────────────────────────────────────
// Webhook
// ──────────────────────────────────────────

async function runWebhook(config, formId, formTitle, data) {
  const { url, secret, method = 'POST' } = config;
  if (!url) throw new Error('Webhook URL is required');
  await assertSafeUrl(url);

  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    const crypto = require('crypto');
    const body = JSON.stringify({ formId, formTitle, data, timestamp: Date.now() });
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-OpenFlow-Signature'] = signature;
  }

  const payload = { event: 'submission', formId, formTitle, data, timestamp: new Date().toISOString() };

  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
    // Don't auto-follow redirects: a validated public URL could redirect to
    // an internal address, bypassing the assertSafeUrl check above.
    redirect: 'manual',
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error('Webhook responded with a redirect, which is not followed for security reasons');
  }
  if (!res.ok) {
    throw new Error(`Webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
  }
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

async function runEmail(config, formId, formTitle, data, steps) {
  const {
    smtp_host, smtp_port = 587, smtp_user, smtp_pass, smtp_secure = false, to, from, subject,
    lodgely_link_enabled, lodgely_url, lodgely_button_text,
  } = config;

  if (!smtp_host || !to) throw new Error('SMTP host and recipient are required');

  const transporter = nodemailer.createTransport({
    host: smtp_host,
    port: Number(smtp_port),
    secure: smtp_secure,
    auth: smtp_user ? { user: smtp_user, pass: smtp_pass } : undefined,
  });

  // Build a nice HTML table from submission data (one row per field, groups expanded)
  const rows = flattenFields(steps).map(field => {
    let val = data[field.id];
    if (val === undefined || val === null) val = '-';
    if (typeof val === 'object') val = JSON.stringify(val);
    if (Array.isArray(val)) val = val.join(', ');
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#555;">${escapeHtmlAttr(field.label || field.question || field.id)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtmlAttr(val)}</td></tr>`;
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

  await transporter.sendMail({
    from: from || `OpenFlow <${smtp_user || 'noreply@openflow.local'}>`,
    to,
    subject: subject || `New submission: ${formTitle}`,
    html,
  });
}

// ──────────────────────────────────────────
// Google Sheets (Simple — via Apps Script)
// ──────────────────────────────────────────

async function runGoogleSheetsAppsScript(config, formId, formTitle, data, steps) {
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
    fields: flattenFields(steps).map(s => ({ id: s.id, label: s.label || s.question || s.id })),
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
}

// ──────────────────────────────────────────
// Google Sheets (Service Account)
// ──────────────────────────────────────────

async function runGoogleSheets(config, formId, data, steps) {
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

  if (!headerRes.data.values || headerRes.data.values.length === 0) {
    const headers = ['Timestamp', ...flattenFields(steps).map(s => s.label || s.question || s.id)];
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet_id,
      range: `${sheet_name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  // Append the submission row (one cell per field, groups expanded)
  const row = [
    new Date().toISOString(),
    ...flattenFields(steps).map(s => {
      let val = data[s.id];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    }),
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheet_id,
    range: `${sheet_name}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
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
    throw new Error('No Google Ads click ID (gclid/gbraid/wbraid) was captured for this submission');
  }

  const accessToken = await getGoogleAdsAccessToken(config);

  let conversionValue = default_value !== undefined ? Number(default_value) : undefined;
  if (value_field_id) {
    const raw = data[value_field_id];
    const parsed = Number(raw);
    if (raw !== undefined && !Number.isNaN(parsed)) conversionValue = parsed;
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
    throw new Error(`Google Ads Data Manager API returned ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

// Validates Google Ads credentials without uploading a conversion — used by
// the integration "Test" button, since a synthetic test submission has no
// real gclid and would either fail or (worse) upload garbage to a real
// Google Ads account.
async function testGoogleAdsCredentials(config) {
  await getGoogleAdsAccessToken(config);
}

module.exports = { runIntegrations, runIntegration, testGoogleAdsCredentials };
