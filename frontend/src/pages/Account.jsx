import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { PageHeader, Alert, Loading } from '../components/AdminUI';
import { ApiTokensCard } from './Settings';

// Sessions and remembered browsers carry epoch-millisecond timestamps.
function formatMs(ms) {
  return ms ? new Date(ms).toLocaleString() : '—';
}

function Section({ icon, title, description, children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-header">
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {description && <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function PasswordSection({ email, onChanged }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    if (next !== confirm) {
      setError('The new passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon="🔒" title="Password" description="Changing it signs out every other session and forgets every other remembered browser.">
      <form onSubmit={handleSubmit}>
        {/* Lets password managers file the new password under the right account. */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        <div className="cols-2" style={{ display: 'grid', gap: 16 }}>
          <div className="input-group">
            <label htmlFor="pw-current">Current password</label>
            <input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
          </div>
          <div />
          <div className="input-group">
            <label htmlFor="pw-new">New password</label>
            <input id="pw-new" className="input" type="password" autoComplete="new-password" minLength={10} maxLength={72} value={next} onChange={e => setNext(e.target.value)} required />
            <span style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4, display: 'block' }}>
              At least 10 characters. A few unrelated words make a strong, memorable password.
            </span>
          </div>
          <div className="input-group">
            <label htmlFor="pw-confirm">Repeat new password</label>
            <input id="pw-confirm" className="input" type="password" autoComplete="new-password" minLength={10} maxLength={72} value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
        </div>
        <Alert type="error">{error}</Alert>
        <Alert type="success">{saved ? 'Password changed. Other sessions were signed out.' : ''}</Alert>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </Section>
  );
}

function TwoFactorSection({ twoFactor, onChanged }) {
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      if (err.code === 'challenge_invalid') setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const start = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await api.startTwoFactor(password);
      setPending(res);
      setPassword('');
      setCode('');
    });
  };

  const confirmCode = (e) => {
    e.preventDefault();
    run(async () => {
      await api.confirmTwoFactor(pending.challenge, code);
      setPending(null);
      onChanged();
    });
  };

  const disable = (e) => {
    e.preventDefault();
    if (!confirm('Turn off two-factor login? Signing in will only need your password.')) return;
    run(async () => {
      await api.disableTwoFactor(password);
      setPassword('');
      onChanged();
    });
  };

  const description = 'When it is on, signing in from a new browser also needs a 6-digit code we e-mail you. Browsers you tick "remember" on skip the code for 30 days.';

  if (twoFactor.enabled) {
    return (
      <Section icon="✉️" title="Two-factor login" description={description}>
        <p style={{ margin: '0 0 12px' }}><span className="badge badge-published">On</span></p>
        {twoFactor.disabledByOperator && (
          <Alert type="error">The administrator has temporarily switched two-factor login off for this server (OPENFLOW_2FA_DISABLED). Sign-ins currently only need your password.</Alert>
        )}
        <form onSubmit={disable} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '1 1 220px', margin: 0 }}>
            <label htmlFor="tfa-off-pw">Current password</label>
            <input id="tfa-off-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-danger" disabled={busy}>Turn off</button>
        </form>
        <Alert type="error" style={{ marginTop: 12 }}>{error}</Alert>
      </Section>
    );
  }

  if (!twoFactor.available) {
    return (
      <Section icon="✉️" title="Two-factor login" description={description}>
        <p style={{ margin: '0 0 4px' }}><span className="badge badge-draft">Off</span></p>
        <p style={{ color: 'var(--text-light)', fontSize: 13, marginBottom: 0 }}>
          {twoFactor.disabledByOperator
            ? 'The administrator has temporarily switched two-factor login off for this server.'
            : 'Not available yet: the server has no outgoing e-mail configured. Ask an administrator to set it up under Settings → System e-mail.'}
        </p>
      </Section>
    );
  }

  return (
    <Section icon="✉️" title="Two-factor login" description={description}>
      <p style={{ margin: '0 0 12px' }}><span className="badge badge-draft">Off</span></p>
      {pending ? (
        <form onSubmit={confirmCode} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '1 1 220px', margin: 0 }}>
            <label htmlFor="tfa-code">Code sent to {pending.email}</label>
            <input
              id="tfa-code"
              className="input login-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))}
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Confirm &amp; turn on</button>
          <button type="button" className="btn btn-secondary" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
        </form>
      ) : (
        <form onSubmit={start} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div className="input-group" style={{ flex: '1 1 220px', margin: 0 }}>
            <label htmlFor="tfa-on-pw">Current password</label>
            <input id="tfa-on-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending code…' : 'Turn on'}</button>
        </form>
      )}
      <Alert type="error" style={{ marginTop: 12 }}>{error}</Alert>
    </Section>
  );
}

function SessionsSection({ sessions, devices, onChanged }) {
  const [error, setError] = useState('');

  async function run(fn) {
    setError('');
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  const others = sessions.filter(s => !s.current).length + devices.filter(d => !d.current).length;

  return (
    <>
      <Section icon="💻" title="Active sessions" description="Every browser or app signed in to your account right now. Sessions end on their own after 7 days.">
        <ul className="account-list">
          {sessions.map(s => (
            <li key={s.id}>
              <div>
                <div>{s.client}{s.current && <span className="badge badge-published" style={{ marginLeft: 8 }}>This browser</span>}</div>
                <div className="account-list-meta">IP {s.ip || '—'} · signed in {formatMs(s.createdAt)} · last active {formatMs(s.lastSeenAt)}</div>
              </div>
              {!s.current && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => run(() => api.revokeSession(s.id))}>Sign out</button>
              )}
            </li>
          ))}
        </ul>
        {others > 0 && (
          <button
            type="button"
            className="btn btn-danger"
            style={{ marginTop: 12 }}
            onClick={() => confirm('Sign out every other session and forget every other remembered browser?') && run(() => api.revokeOtherSessions())}
          >
            Sign out everywhere else
          </button>
        )}
        <Alert type="error" style={{ marginTop: 12 }}>{error}</Alert>
      </Section>

      <Section icon="🧭" title="Remembered browsers" description={'Browsers that signed in to your account in the last 30 days. They are not held back by the lockout after failed sign-in attempts, and those marked "skips code" don\'t need the e-mailed code.'}>
        {devices.length === 0 ? (
          <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>None.</p>
        ) : (
          <ul className="account-list">
            {devices.map(d => (
              <li key={d.id}>
                <div>
                  <div>
                    {d.client}
                    {d.current && <span className="badge badge-published" style={{ marginLeft: 8 }}>This browser</span>}
                    {d.skipsCode && <span className="badge badge-draft" style={{ marginLeft: 8 }}>skips code</span>}
                  </div>
                  <div className="account-list-meta">IP {d.ip || '—'} · last used {formatMs(d.lastUsedAt)} · until {formatMs(d.expiresAt)}</div>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => run(() => api.forgetDevice(d.id))}>Forget</button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export default function Account({ user, onUserChange }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getAccount().then(setAccount).catch(err => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  function refresh() {
    load();
    api.me().then(d => onUserChange(d.user)).catch(() => {});
  }

  if (error) return <Alert type="error">{error}</Alert>;
  if (!account) return <Loading />;

  return (
    <div>
      <PageHeader title="Account" subtitle={user.email} />
      <PasswordSection email={user.email} onChanged={refresh} />
      <TwoFactorSection twoFactor={account.twoFactor} onChanged={refresh} />
      <SessionsSection sessions={account.sessions} devices={account.devices} onChanged={load} />
      <ApiTokensCard />
    </div>
  );
}
