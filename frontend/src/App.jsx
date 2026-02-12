import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FormEditor from './pages/FormEditor';
import Submissions from './pages/Submissions';
import Users from './pages/Users';
import Analytics from './pages/Analytics';

const APP_VERSION = '0.6.0';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    api.me().then(d => setUser(d.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  if (!user) {
    return <Login onLogin={(u) => { setUser(u); navigate('/'); }} />;
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
  }

  const isAdmin = user.role === 'admin';

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <h1><span className="logo-icon">&#9830;</span>OpenFlow</h1>
        <nav>
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>Forms</Link>
          <Link to="/analytics" className={location.pathname === '/analytics' ? 'active' : ''}>Analytics</Link>
          {isAdmin && <Link to="/users" className={location.pathname === '/users' ? 'active' : ''}>Users</Link>}
        </nav>
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <span style={{ fontSize: 13, opacity: 0.5, display: 'block', padding: '0 12px', marginBottom: 8 }}>{user.email}</span>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13, padding: '8px 12px', cursor: 'pointer' }}>
            Log out
          </button>
          <a href="https://github.com/vidual-labs/openflow" target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.3)', padding: '8px 12px', textDecoration: 'none' }}>
            v{APP_VERSION} &middot; GitHub
          </a>
        </div>
      </aside>
      <main className="admin-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/forms/:id" element={<FormEditor />} />
          <Route path="/forms/:id/submissions" element={<Submissions />} />
          <Route path="/analytics" element={<Analytics />} />
          {isAdmin && <Route path="/users" element={<Users />} />}
        </Routes>
      </main>
    </div>
  );
}
