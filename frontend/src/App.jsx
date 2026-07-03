import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FormEditor from './pages/FormEditor';
import Submissions from './pages/Submissions';
import Users from './pages/Users';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Backup from './pages/Backup';
import { LogoMark, Loading } from './components/AdminUI';
import { version as APP_VERSION } from '../package.json';

function getInitialTheme() {
  return localStorage.getItem('of_theme') || 'auto';
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(getInitialTheme);
  const [branding, setBranding] = useState({ logoVisible: true, logoUrl: '' });
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    Promise.all([
      api.me().then(d => setUser(d.user)).catch(() => setUser(null)),
      api.getSettings().then(d => { if (d.settings?.branding) setBranding(b => ({ ...b, ...d.settings.branding })); }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    localStorage.setItem('of_theme', theme);
  }, [theme]);

  function cycleTheme() {
    setTheme(prev => prev === 'auto' ? 'dark' : prev === 'dark' ? 'light' : 'auto');
  }

  const themeIcon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️';
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto';

  if (loading) return <Loading />;

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
        <h1><LogoMark size={28} className="logo-mark" />OpenFlow</h1>
        <nav>
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>Forms</Link>
          <Link to="/analytics" className={location.pathname === '/analytics' ? 'active' : ''}>Analytics</Link>
          {isAdmin && <Link to="/users" className={location.pathname === '/users' ? 'active' : ''}>Users</Link>}
          {isAdmin && <Link to="/settings" className={location.pathname === '/settings' ? 'active' : ''}>Settings</Link>}
          {isAdmin && <Link to="/backup" className={location.pathname === '/backup' ? 'active' : ''}>Backup</Link>}
        </nav>
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <span style={{ fontSize: 13, opacity: 0.5, display: 'block', padding: '0 12px', marginBottom: 8 }}>{user.email}</span>
          <button className="theme-toggle" onClick={cycleTheme}>
            <span className="theme-toggle-icon">{themeIcon}</span> {themeLabel}
          </button>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13, padding: '8px 12px', cursor: 'pointer' }}>
            Log out
          </button>
          <a href="https://github.com/vidual-labs/openflow" target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.3)', padding: '8px 12px', textDecoration: 'none' }}>
            {branding.logoVisible && (
              <img
                src={branding.logoUrl || '/vidual-logo.png'}
                alt="Logo"
                style={{ height: 18, opacity: 0.4, display: 'block', marginBottom: 4, maxWidth: 120, objectFit: 'contain' }}
              />
            )}
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
          {isAdmin && <Route path="/settings" element={<Settings />} />}
          {isAdmin && <Route path="/backup" element={<Backup />} />}
        </Routes>
      </main>
    </div>
  );
}
