const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// ──────────────────────────────────────────
// Run all integrations for a form submission
// ──────────────────────────────────────────

async function runIntegrations(db, formId, formTitle, submissionData, steps) {
  const integrations = db.prepare(
    'SELECT * FROM integrations WHERE form_id = ? AND enabled = 1'
  ).all(formId);

  const results = [];
  for (const integration of integrations) {
    try {
      const config = JSON.parse(integration.config);
      switch (integration.type) {
        case 'webhook':
          await runWebhook(config, formId, formTitle, submissionData);
          break;
        case 'email':
          await runEmail(config, formId, formTitle, submissionData, steps);
          break;
        case 'google_sheets':
          if (config.mode === 'apps_script') {
            await runGoogleSheetsAppsScript(config, formId, formTitle, submissionData, steps);
          } else {
            await runGoogleSheets(config, formId, submissionData, steps);
          }
          break;
      }
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
  });

  if (!res.ok) {
    throw new Error(`Webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

// ──────────────────────────────────────────
// Email notification
// ──────────────────────────────────────────

async function runEmail(config, formId, formTitle, data, steps) {
  const { smtp_host, smtp_port = 587, smtp_user, smtp_pass, smtp_secure = false, to, from, subject } = config;

  if (!smtp_host || !to) throw new Error('SMTP host and recipient are required');

  const transporter = nodemailer.createTransport({
    host: smtp_host,
    port: Number(smtp_port),
    secure: smtp_secure,
    auth: smtp_user ? { user: smtp_user, pass: smtp_pass } : undefined,
  });

  // Build a nice HTML table from submission data
  const rows = (steps || []).map(step => {
    let val = data[step.id];
    if (val === undefined || val === null) val = '-';
    if (typeof val === 'object') val = JSON.stringify(val);
    if (Array.isArray(val)) val = val.join(', ');
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#555;">${step.label || step.question || step.id}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${val}</td></tr>`;
  }).join('');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#6C5CE7;">New Submission: ${formTitle}</h2>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        ${rows}
      </table>
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

  const payload = {
    formId,
    formTitle,
    data,
    fields: (steps || []).map(s => ({ id: s.id, label: s.label || s.question || s.id })),
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
    const headers = ['Timestamp', ...(steps || []).map(s => s.label || s.question || s.id)];
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet_id,
      range: `${sheet_name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  // Append the submission row
  const row = [
    new Date().toISOString(),
    ...(steps || []).map(s => {
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

module.exports = { runIntegrations };
