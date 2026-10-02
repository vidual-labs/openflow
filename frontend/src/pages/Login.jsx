import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Alert, LogoMark, LogoWordmark } from '../components/AdminUI';

export default function Login({ onLogin, backHref }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Second step for two-factor accounts: { challenge, email } from the server.
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [notice, setNotice] = useState('');

  async function signIn() {
    const res = await api.login(email, password);
    if (res.twoFactorRequired) {
      setPending({ challenge: res.challenge, email: res.email, minutes: res.expiresInMinutes });
      setCode('');
      return;
    }
    onLogin(res.user);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await signIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { user } = await api.verifyLogin(pending.challenge, code, remember);
      onLogin(user);
    } catch (err) {
      setError(err.message);
      // The code can't be retried any more: back to the password step.
      if (err.code === 'challenge_invalid') {
        setPending(null);
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await signIn();
      setNotice('A new code is on its way. Only the newest code works.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function backToPassword() {
    setPending(null);
    setPassword('');
    setError('');
    setNotice('');
  }

  return (
    <div className="login-container">
      <div className="login-box card">
        <h1><LogoMark size={32} className="logo-mark" /><LogoWordmark /></h1>
        {pending ? (
          <form onSubmit={handleVerify}>
            <p className="login-hint">
              We sent a 6-digit code to <strong>{pending.email}</strong>. It is valid for {pending.minutes || 10} minutes.
            </p>
            <div className="input-group">
              <label htmlFor="login-code">Login code</label>
              <input
                id="login-code"
                className="input login-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))}
                autoFocus
                required
              />
            </div>
            <label className="login-remember">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              Remember this browser for 30 days
            </label>
            <Alert type="error">{error}</Alert>
            <Alert type="success">{notice}</Alert>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Checking…' : 'Verify'}
            </button>
            <div className="login-links">
              <button type="button" className="login-link-btn" onClick={handleResend} disabled={busy}>Send a new code</button>
              <button type="button" className="login-link-btn" onClick={backToPassword} disabled={busy}>Use a different account</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <label htmlFor="login-email">E-Mail</label>
              <input id="login-email" className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="input-group">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <Alert type="error">{error}</Alert>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
        {backHref && <Link to={backHref} className="login-back">← Back to home</Link>}
      </div>
    </div>
  );
}
