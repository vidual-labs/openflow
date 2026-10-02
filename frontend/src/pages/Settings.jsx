import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { formatServerDate, formatServerDateTime } from '../utils/dates';
import { PageHeader, Alert } from '../components/AdminUI';

const DEFAULT_BRANDING = { logoVisible: true, logoUrl: '' };

export default function Settings() {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSettings()
      .then(d => {
        if (d.settings?.branding) setBranding({ ...DEFAULT_BRANDING, ...d.settings.branding });
      })
      .catch(() => {});
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    try {
      await api.updateSettings('branding', branding);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" />

      <form onSubmit={handleSave}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <span style={{ fontSize: 20 }}>🎨</span>
            <div>
              <h3 style={{ margin: 0 }}>Branding</h3>
              <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Customise the logo shown at the bottom of the admin sidebar.</p>
            </div>
          </div>

          <div className="cols-2" style={{ display: 'grid', gap: 16 }}>
            <div className="input-group">
              <label>Sidebar Logo</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, cursor: 'pointer', marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={branding.logoVisible}
                  onChange={e => setBranding(b => ({ ...b, logoVisible: e.target.checked }))}
                  style={{ width: 20, height: 20, accentColor: 'var(--primary)' }}
                />
                Show logo in sidebar
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 8, display: 'block' }}>
                Uncheck to hide the logo entirely from the sidebar footer.
              </span>
            </div>

            <div className="input-group">
              <label>Logo URL</label>
              <input
                className="input"
                type="url"
                value={branding.logoUrl}
                onChange={e => setBranding(b => ({ ...b, logoUrl: e.target.value }))}
                placeholder="https://example.com/logo.png"
                disabled={!branding.logoVisible}
              />
              <span style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4, display: 'block' }}>
                Leave blank to use the built-in default logo. Best results: white PNG/SVG, max height 24px.
              </span>
            </div>
          </div>

          {branding.logoVisible && branding.logoUrl && (
            <div style={{ marginTop: 16, padding: 16, background: 'var(--sidebar-bg)', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Preview:</span>
              <img src={branding.logoUrl} alt="Logo preview" style={{ height: 20, maxWidth: 140, objectFit: 'contain' }} />
            </div>
          )}
        </div>

        <Alert type="error">{error}</Alert>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-primary" type="submit">Save Settings</button>
          {saved && <span style={{ fontSize: 14, color: 'var(--success)' }}>Saved!</span>}
        </div>
      </form>

      <SystemMailCard />
    </div>
  );
}

// Outgoing mail is configured by the operator through SMTP_* environment
// variables; this only shows whether it is set up and lets an admin send a
// test message before anyone relies on e-mailed login codes.
function SystemMailCard() {
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState({ type: '', text: '' });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.getMailStatus().then(setStatus).catch(() => {});
  }, []);

  async function handleTest() {
    setResult({ type: '', text: '' });
    setSending(true);
    try {
      const d = await api.sendTestMail();
      setResult({ type: 'success', text: `Test e-mail sent to ${d.to}.` });
    } catch (err) {
      setResult({ type: 'error', text: err.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="section-header">
        <span style={{ fontSize: 20 }}>✉️</span>
        <div>
          <h3 style={{ margin: 0 }}>System e-mail</h3>
          <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>
            Sends two-factor login codes and security notices (new sign-in, password changed, repeated failed logins).
            Configured on the server with the <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>SMTP_FROM</code> environment variables.
          </p>
        </div>
      </div>
      {!status ? null : status.configured ? (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>
            <span className="badge badge-published">configured</span>{' '}
            <span style={{ color: 'var(--text-light)' }}>{status.host}:{status.port} · from {status.from}</span>
          </p>
          <button type="button" className="btn btn-secondary" onClick={handleTest} disabled={sending}>
            {sending ? 'Sending…' : 'Send test e-mail to me'}
          </button>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 14 }}>
          <span className="badge badge-draft">not configured</span>{' '}
          <span style={{ color: 'var(--text-light)' }}>Users can't turn on two-factor login until it is.</span>
        </p>
      )}
      {status?.twoFactorDisabledByOperator && (
        <Alert type="error" style={{ marginTop: 12 }}>
          <code>OPENFLOW_2FA_DISABLED</code> is set: accounts with two-factor login currently sign in with their password only. Remove it once e-mail works again.
        </Alert>
      )}
      <Alert type={result.type || 'error'} style={{ marginTop: 12, marginBottom: 0 }}>{result.text}</Alert>
    </div>
  );
}

export function ApiTokensCard() {
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // The plaintext of a token we just created — shown exactly once.
  const [revealed, setRevealed] = useState(null);
  const [copied, setCopied] = useState(false);

  function load() {
    api.getApiTokens()
      .then(d => setTokens(d.tokens || []))
      .catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Give the token a name.'); return; }
    setCreating(true);
    try {
      const d = await api.createApiToken(name.trim());
      setRevealed(d.token.token);
      setCopied(false);
      setName('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id) {
    if (!window.confirm('Revoke this token? Anything using it (e.g. a lodgely source) will stop working immediately.')) return;
    setError('');
    try {
      await api.deleteApiToken(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function copyToken() {
    navigator.clipboard?.writeText(revealed).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="section-header">
        <span style={{ fontSize: 20 }}>🔑</span>
        <div>
          <h3 style={{ margin: 0 }}>API Tokens</h3>
          <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>
            Read-only tokens for programmatic API access — e.g. the lodgely lead-intake connector.
            A token can read your forms and submissions but cannot change anything, and can be revoked
            here at any time without affecting your password. Connect integrations with a token rather
            than your password — it keeps working when two-factor login is on.
          </p>
        </div>
      </div>

      {revealed && (
        <div style={{ marginBottom: 16, padding: 14, background: 'var(--sidebar-bg)', borderRadius: 10 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
            ⚠️ Copy this token now — it will not be shown again.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <code style={{ flex: 1, color: '#fff', fontSize: 13, wordBreak: 'break-all', fontFamily: 'monospace' }}>{revealed}</code>
            <button type="button" className="btn btn-primary" onClick={copyToken}>{copied ? 'Copied!' : 'Copy'}</button>
            <button type="button" className="btn" onClick={() => setRevealed(null)}>Done</button>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="input-group" style={{ flex: '1 1 200px', margin: 0 }}>
          <label>Token name</label>
          <input
            className="input"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. lodgely — Acme client"
            maxLength={100}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={creating}>
          {creating ? 'Generating…' : 'Generate token'}
        </button>
      </form>

      <Alert type="error">{error}</Alert>

      {tokens.length === 0 ? (
        <p style={{ color: 'var(--text-light)', fontSize: 13 }}>No API tokens yet.</p>
      ) : (
        <table className="token-table table-cards">
          <thead>
            <tr>
              <th>Name</th>
              <th>Token</th>
              <th>Last used</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map(t => (
              <tr key={t.id}>
                <td className="cell-primary">{t.name}</td>
                <td data-label="Token" style={{ fontFamily: 'monospace', color: 'var(--text-light)' }}>{t.token_prefix}…</td>
                <td data-label="Last used" style={{ color: 'var(--text-light)' }}>{formatServerDateTime(t.last_used_at)}</td>
                <td data-label="Created" style={{ color: 'var(--text-light)' }}>{formatServerDate(t.created_at)}</td>
                <td className="cell-actions" style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-danger" onClick={() => handleRevoke(t.id)}>Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
