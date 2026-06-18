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
    </div>
  );
}
