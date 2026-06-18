import React, { useState } from 'react';
import { api } from '../api';
import { Alert, LogoMark } from '../components/AdminUI';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { user } = await api.login(email, password);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-container">
      <div className="login-box card">
        <h1><LogoMark size={32} className="logo-mark" />OpenFlow</h1>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>E-Mail</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <Alert type="error">{error}</Alert>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
