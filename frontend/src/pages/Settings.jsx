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

// OpenFlow's own outgoing mail: two-factor login codes and security notices.
// Edited here unless the server sets SMTP_* in its environment, which wins
// and turns this card read-only. Saving first checks that the mail server
// accepts the settings; the password is write-only.
const ENCRYPTION_OPTIONS = [
  { value: 'starttls', label: 'STARTTLS (587)', port: 587 },
  { value: 'ssl', label: 'SSL/TLS (465)', port: 465 },
  { value: 'none', label: 'None (local relay)', port: 25 },
];

function encryptionOf(settings) {
  if (settings.secure) return 'ssl';
  return settings.requireTLS === false ? 'none' : 'starttls';
}

const EMPTY_MAIL = { host: '', port: 587, encryption: 'starttls', user: '', from: '' };

function SystemMailCard() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(EMPTY_MAIL);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [result, setResult] = useState({ type: '', text: '' });
  const [verifyFailed, setVerifyFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  function apply(d) {
    setStatus(d);
    const st = d.settings || {};
    setForm(st.host ? { host: st.host, port: st.port, encryption: encryptionOf(st), user: st.user, from: st.from } : EMPTY_MAIL);
    setPassword('');
    setClearPassword(false);
  }

  useEffect(() => {
    api.getMailStatus().then(apply).catch(err => setResult({ type: 'error', text: err.message }));
  }, []);

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
    setVerifyFailed(false);
  }

  function setEncryption(value) {
    const option = ENCRYPTION_OPTIONS.find(o => o.value === value);
    // Follow the port along with the encryption unless it was customised.
    const standardPorts = ENCRYPTION_OPTIONS.map(o => o.port);
    setForm(f => ({ ...f, encryption: value, port: standardPorts.includes(Number(f.port)) ? option.port : f.port }));
    setVerifyFailed(false);
  }

  async function save(e, { skipVerify = false } = {}) {
    if (e) e.preventDefault();
    setResult({ type: '', text: '' });
    setBusy(true);
    const payload = {
      host: form.host.trim(),
      port: Number(form.port),
      secure: form.encryption === 'ssl',
      requireTLS: form.encryption !== 'none',
      user: form.user.trim(),
      from: form.from.trim(),
      skipVerify,
    };
    if (password) payload.password = password;
    else if (clearPassword) payload.password = '';
    try {
      const d = await api.saveMailSettings(payload);
      apply(d);
      setVerifyFailed(false);
      setResult({ type: 'success', text: skipVerify ? 'Saved without checking the connection.' : 'Saved — the mail server accepted the login.' });
    } catch (err) {
      setVerifyFailed(err.code === 'verify_failed');
      setResult({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setResult({ type: '', text: '' });
    setBusy(true);
    try {
      const d = await api.sendTestMail();
      setResult({ type: 'success', text: `Test e-mail sent to ${d.to}.` });
    } catch (err) {
      setResult({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    const users = status?.twoFactorUsers || 0;
    const warning = users > 0
      ? `${users} user${users === 1 ? ' has' : 's have'} two-factor login on and can't sign in from a new browser without e-mail. Remove the mail settings anyway?`
      : 'Remove the mail settings? Two-factor login can then no longer be turned on.';
    if (!confirm(warning)) return;
    setBusy(true);
    try {
      apply(await api.deleteMailSettings());
      setResult({ type: 'success', text: 'Mail settings removed.' });
    } catch (err) {
      setResult({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const locked = !!status?.locked;
  const passwordSet = !!status?.settings?.passwordSet && !clearPassword;

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="section-header">
        <span style={{ fontSize: 20 }}>✉️</span>
        <div>
          <h3 style={{ margin: 0 }}>System e-mail</h3>
          <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>
            The mailbox OpenFlow sends two-factor login codes and security notices from (new sign-in,
            password changed, repeated failed logins). Separate from a form&apos;s own e-mail integration.
          </p>
        </div>
      </div>

      {!status ? null : (
        <>
          <p style={{ margin: '0 0 16px', fontSize: 14 }}>
            {status.configured
              ? <span className="badge badge-published">configured</span>
              : <span className="badge badge-draft">not configured</span>}{' '}
            <span style={{ color: 'var(--text-light)' }}>
              {locked
                ? <>Managed by the server environment (<code>SMTP_*</code> variables) — change it there.</>
                : status.configured
                  ? 'Set up here.'
                  : 'Users can\'t turn on two-factor login until it is set up.'}
            </span>
          </p>

          <form onSubmit={save}>
            <fieldset disabled={locked || busy} style={{ border: 'none', padding: 0, margin: 0 }}>
              <div className="cols-2" style={{ display: 'grid', gap: 16 }}>
                <div className="input-group">
                  <label htmlFor="smtp-host">SMTP server</label>
                  <input id="smtp-host" className="input" value={form.host} onChange={e => set('host', e.target.value)} placeholder="smtp.example.com" required autoComplete="off" />
                </div>
                <div className="cols-2" style={{ display: 'grid', gap: 16 }}>
                  <div className="input-group">
                    <label htmlFor="smtp-encryption">Encryption</label>
                    <select id="smtp-encryption" className="input" value={form.encryption} onChange={e => setEncryption(e.target.value)}>
                      {ENCRYPTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="smtp-port">Port</label>
                    <input id="smtp-port" className="input" type="number" min={1} max={65535} value={form.port} onChange={e => set('port', e.target.value)} required />
                  </div>
                </div>
                <div className="input-group">
                  <label htmlFor="smtp-user">User name</label>
                  <input id="smtp-user" className="input" value={form.user} onChange={e => set('user', e.target.value)} placeholder="no-reply@example.com" autoComplete="off" />
                </div>
                <div className="input-group">
                  <label htmlFor="smtp-pass">Password</label>
                  <input
                    id="smtp-pass"
                    className="input"
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setVerifyFailed(false); }}
                    placeholder={locked ? (passwordSet ? 'Set in the environment' : '') : passwordSet ? 'Saved — leave empty to keep' : ''}
                    autoComplete="new-password"
                  />
                  {!locked && passwordSet && !password && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12, color: 'var(--text-light)' }}>
                      <span>🔒 Stored encrypted — not shown again</span>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setClearPassword(true)}>Remove</button>
                    </div>
                  )}
                </div>
                <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="smtp-from">Sender</label>
                  <input id="smtp-from" className="input" value={form.from} onChange={e => set('from', e.target.value)} placeholder="OpenFlow <no-reply@example.com>" autoComplete="off" />
                  <span style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4, display: 'block' }}>
                    Name and address the mails come from. Most providers only accept an address of the mailbox you log in with. Left empty, the user name is used if it is an address.
                  </span>
                </div>
              </div>
            </fieldset>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
              {!locked && (
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Checking…' : 'Save & check connection'}
                </button>
              )}
              {!locked && verifyFailed && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(null, { skipVerify: true })}>
                  Save anyway
                </button>
              )}
              {status.configured && (
                <button type="button" className="btn btn-secondary" onClick={handleTest} disabled={busy}>
                  Send test e-mail to me
                </button>
              )}
              {!locked && status.source === 'ui' && (
                <button type="button" className="btn btn-danger" onClick={handleRemove} disabled={busy} style={{ marginLeft: 'auto' }}>
                  Remove
                </button>
              )}
            </div>
          </form>
        </>
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
