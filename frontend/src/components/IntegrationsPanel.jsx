import React, { useState, useEffect } from 'react';
import { api } from '../api';

const INTEGRATION_TYPES = [
  { value: 'webhook', label: 'Webhook', icon: '🔗', description: 'Send submission data to any URL' },
  { value: 'email', label: 'Email Notification', icon: '📧', description: 'Send email on each submission' },
  { value: 'google_sheets', label: 'Google Sheets (Simple)', icon: '📊', description: 'Via Google Apps Script — no JSON key needed' },
  { value: 'google_sheets_sa', label: 'Google Sheets (Service Account)', icon: '📊', description: 'Via service account JSON key' },
];

export default function IntegrationsPanel({ formId }) {
  const [integrations, setIntegrations] = useState([]);
  const [adding, setAdding] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    api.getIntegrations(formId).then(d => setIntegrations(d.integrations));
  }, [formId]);

  async function addIntegration(type) {
    const actualType = type === 'google_sheets_sa' ? 'google_sheets' : type;
    const defaults = {
      webhook: { url: '', secret: '', method: 'POST' },
      email: { smtp_host: '', smtp_port: 587, smtp_user: '', smtp_pass: '', smtp_secure: false, to: '', from: '', subject: '' },
      google_sheets: { mode: 'apps_script', apps_script_url: '' },
      google_sheets_sa: { mode: 'service_account', credentials_json: '', spreadsheet_id: '', sheet_name: 'Sheet1' },
    };
    const { integration } = await api.createIntegration(formId, { type: actualType, config: defaults[type] || defaults[actualType] });
    setIntegrations([integration, ...integrations]);
    setAdding(null);
  }

  async function updateIntegration(id, updates) {
    const { integration } = await api.updateIntegration(formId, id, updates);
    setIntegrations(integrations.map(i => i.id === id ? integration : i));
  }

  async function deleteIntegration(id) {
    if (!confirm('Delete this integration?')) return;
    await api.deleteIntegration(formId, id);
    setIntegrations(integrations.filter(i => i.id !== id));
  }

  async function testIntegration(id) {
    setTesting(id);
    setTestResult(null);
    try {
      const result = await api.testIntegration(formId, id);
      setTestResult({ id, ok: result.results?.[0]?.ok, error: result.results?.[0]?.error });
    } catch (err) {
      setTestResult({ id, ok: false, error: err.message });
    }
    setTesting(null);
  }

  function updateConfig(id, key, value) {
    const integration = integrations.find(i => i.id === id);
    if (!integration) return;
    const newConfig = { ...integration.config, [key]: value };
    updateIntegration(id, { config: newConfig });
  }

  return (
    <div>
      {/* Add new integration */}
      {!adding ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {INTEGRATION_TYPES.map(t => (
            <button key={t.value} className="btn btn-secondary" onClick={() => addIntegration(t.value)}>
              <span>{t.icon}</span> Add {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {integrations.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <h3 style={{ marginBottom: 8 }}>No integrations yet</h3>
          <p style={{ color: '#636E72' }}>Add a webhook, email notification, or Google Sheets integration.</p>
        </div>
      )}

      {integrations.map(integration => (
        <div key={integration.id} className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>{INTEGRATION_TYPES.find(t => t.value === integration.type)?.icon}</span>
              <div>
                <strong>{INTEGRATION_TYPES.find(t => t.value === integration.type)?.label}</strong>
                <span className={`badge ${integration.enabled ? 'badge-published' : 'badge-draft'}`} style={{ marginLeft: 8 }}>
                  {integration.enabled ? 'Active' : 'Disabled'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => updateIntegration(integration.id, { enabled: !integration.enabled })}
              >
                {integration.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => testIntegration(integration.id)}
                disabled={testing === integration.id}
              >
                {testing === integration.id ? 'Testing...' : 'Test'}
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => deleteIntegration(integration.id)}>Delete</button>
            </div>
          </div>

          {testResult && testResult.id === integration.id && (
            <div style={{
              padding: '8px 12px', marginBottom: 16, borderRadius: 8, fontSize: 13,
              background: testResult.ok ? '#E8F8F5' : '#FDEDEC',
              color: testResult.ok ? '#00B894' : '#E17055',
            }}>
              {testResult.ok ? 'Test successful!' : `Test failed: ${testResult.error}`}
            </div>
          )}

          {integration.type === 'webhook' && (
            <WebhookConfig config={integration.config} onChange={(k, v) => updateConfig(integration.id, k, v)} />
          )}
          {integration.type === 'email' && (
            <EmailConfig config={integration.config} onChange={(k, v) => updateConfig(integration.id, k, v)} />
          )}
          {integration.type === 'google_sheets' && (
            <GoogleSheetsConfig config={integration.config} onChange={(k, v) => updateConfig(integration.id, k, v)} />
          )}
        </div>
      ))}
    </div>
  );
}

function WebhookConfig({ config, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div className="input-group" style={{ gridColumn: '1 / -1' }}>
        <label>Webhook URL</label>
        <input className="input" value={config.url || ''} onChange={e => onChange('url', e.target.value)} placeholder="https://example.com/webhook" />
      </div>
      <div className="input-group">
        <label>Method</label>
        <select className="input" value={config.method || 'POST'} onChange={e => onChange('method', e.target.value)}>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
        </select>
      </div>
      <div className="input-group">
        <label>Secret (optional, for HMAC signature)</label>
        <input className="input" type="password" value={config.secret || ''} onChange={e => onChange('secret', e.target.value)} placeholder="Optional signing secret" />
      </div>
    </div>
  );
}

function EmailConfig({ config, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div className="input-group">
        <label>SMTP Host</label>
        <input className="input" value={config.smtp_host || ''} onChange={e => onChange('smtp_host', e.target.value)} placeholder="smtp.gmail.com" />
      </div>
      <div className="input-group">
        <label>SMTP Port</label>
        <input className="input" type="number" value={config.smtp_port || 587} onChange={e => onChange('smtp_port', Number(e.target.value))} />
      </div>
      <div className="input-group">
        <label>SMTP User</label>
        <input className="input" value={config.smtp_user || ''} onChange={e => onChange('smtp_user', e.target.value)} placeholder="user@gmail.com" />
      </div>
      <div className="input-group">
        <label>SMTP Password</label>
        <input className="input" type="password" value={config.smtp_pass || ''} onChange={e => onChange('smtp_pass', e.target.value)} />
      </div>
      <div className="input-group">
        <label>To (recipient)</label>
        <input className="input" value={config.to || ''} onChange={e => onChange('to', e.target.value)} placeholder="notify@company.com" />
      </div>
      <div className="input-group">
        <label>From (optional)</label>
        <input className="input" value={config.from || ''} onChange={e => onChange('from', e.target.value)} placeholder="OpenFlow <noreply@...>" />
      </div>
      <div className="input-group" style={{ gridColumn: '1 / -1' }}>
        <label>Subject (optional)</label>
        <input className="input" value={config.subject || ''} onChange={e => onChange('subject', e.target.value)} placeholder="New submission: {form title}" />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={config.smtp_secure || false} onChange={e => onChange('smtp_secure', e.target.checked)} />
        Use SSL/TLS (port 465)
      </label>
    </div>
  );
}

function GoogleSheetsConfig({ config, onChange }) {
  const mode = config.mode || 'service_account';

  if (mode === 'apps_script') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        <div className="input-group">
          <label>Google Apps Script Web App URL</label>
          <input className="input" value={config.apps_script_url || ''} onChange={e => onChange('apps_script_url', e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" />
        </div>
        <div style={{ background: '#F0F4FF', borderRadius: 8, padding: 16, fontSize: 13, lineHeight: 1.7 }}>
          <strong>Setup (3 steps):</strong>
          <ol style={{ margin: '8px 0 0 16px', padding: 0 }}>
            <li>Open your Google Sheet &rarr; Extensions &rarr; Apps Script</li>
            <li>Replace the code with the script below, click <strong>Deploy &rarr; New deployment &rarr; Web app</strong></li>
            <li>Set "Who has access" to <strong>Anyone</strong>, then copy the URL here</li>
          </ol>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Show Apps Script code</summary>
            <pre style={{ background: '#1a1a2e', color: '#e0e0e0', padding: 12, borderRadius: 6, marginTop: 8, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{`function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  // Write headers if first row is empty
  if (sheet.getLastRow() === 0) {
    var headers = ['Timestamp'].concat(Object.keys(data.data || {}));
    sheet.appendRow(headers);
  }

  // Append the submission row
  var row = [new Date().toISOString()];
  var keys = Object.keys(data.data || {});
  keys.forEach(function(key) {
    var val = data.data[key];
    row.push(typeof val === 'object' ? JSON.stringify(val) : val);
  });
  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ok: true}))
    .setMimeType(ContentService.MimeType.JSON);
}`}</pre>
          </details>
        </div>
      </div>
    );
  }

  // Service account mode
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div className="input-group" style={{ gridColumn: '1 / -1' }}>
        <label>Spreadsheet ID</label>
        <input className="input" value={config.spreadsheet_id || ''} onChange={e => onChange('spreadsheet_id', e.target.value)} placeholder="From the Google Sheets URL" />
        <p style={{ fontSize: 12, color: '#636E72', marginTop: 4 }}>
          Find it in the URL: docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit
        </p>
      </div>
      <div className="input-group">
        <label>Sheet Name</label>
        <input className="input" value={config.sheet_name || 'Sheet1'} onChange={e => onChange('sheet_name', e.target.value)} />
      </div>
      <div className="input-group" style={{ gridColumn: '1 / -1' }}>
        <label>Service Account Credentials (JSON)</label>
        <textarea
          className="input"
          rows={6}
          value={typeof config.credentials_json === 'object' ? JSON.stringify(config.credentials_json, null, 2) : (config.credentials_json || '')}
          onChange={e => {
            try { onChange('credentials_json', JSON.parse(e.target.value)); } catch { onChange('credentials_json', e.target.value); }
          }}
          placeholder='Paste your Google service account JSON key here...'
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        <p style={{ fontSize: 12, color: '#636E72', marginTop: 4 }}>
          Create a service account in Google Cloud Console, download the JSON key, and share the spreadsheet with the service account email.
        </p>
      </div>
    </div>
  );
}
