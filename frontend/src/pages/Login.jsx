import React, { useState } from 'react';
import { api } from '../api';

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
        <h1>OpenFlow</h1>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>E-Mail</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Passwort</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p style={{ color: '#E17055', marginBottom: 16, fontSize: 14 }}>{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            Anmelden
          </button>
        </form>
      </div>
    </div>
  );
}
