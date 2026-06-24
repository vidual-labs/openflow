import React, { useState, useEffect } from 'react';
import { api } from '../api';
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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

      <ApiTokensCard />
    </div>
  );
}

function ApiTokensCard() {
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
            here at any time without affecting your password.
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

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="input-group" style={{ flex: 1, margin: 0 }}>
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-light)', fontSize: 12 }}>
              <th style={{ padding: '6px 8px' }}>Name</th>
              <th style={{ padding: '6px 8px' }}>Token</th>
              <th style={{ padding: '6px 8px' }}>Last used</th>
              <th style={{ padding: '6px 8px' }}>Created</th>
              <th style={{ padding: '6px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map(t => (
              <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>{t.name}</td>
                <td style={{ padding: '8px', fontFamily: 'monospace', color: 'var(--text-light)' }}>{t.token_prefix}…</td>
                <td style={{ padding: '8px', color: 'var(--text-light)' }}>{t.last_used_at ? new Date(t.last_used_at + 'Z').toLocaleString() : '—'}</td>
                <td style={{ padding: '8px', color: 'var(--text-light)' }}>{t.created_at ? new Date(t.created_at + 'Z').toLocaleDateString() : '—'}</td>
                <td style={{ padding: '8px', textAlign: 'right' }}>
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
