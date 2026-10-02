import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FormEditor from './pages/FormEditor';
import Submissions from './pages/Submissions';
import Users from './pages/Users';
import Analytics from './pages/Analytics';
import FormAnalytics from './pages/FormAnalytics';
import Settings from './pages/Settings';
import Backup from './pages/Backup';
import Account from './pages/Account';
import { LogoMark, LogoWordmark, Loading, EmptyState, Alert } from './components/AdminUI';
import { version as APP_VERSION } from '../package.json';

// Only fetched when OPENFLOW_LANDING_PAGE is on, so the admin bundle doesn't
// carry the marketing page's code and styles.
const Landing = lazy(() => import('./pages/Landing'));

function getInitialTheme() {
  return localStorage.getItem('of_theme') || 'auto';
}

function NotFound() {
  return (
    <EmptyState title="Page not found" message="There is nothing at this address.">
      <Link to="/" className="btn btn-primary">Back to forms</Link>
    </EmptyState>
  );
}

function Forbidden() {
  return (
    <EmptyState title="Admins only" message="This page is only available to administrators.">
      <Link to="/" className="btn btn-primary">Back to forms</Link>
    </EmptyState>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(getInitialTheme);
  const [branding, setBranding] = useState({ logoVisible: true, logoUrl: '' });
  const [landingPage, setLandingPage] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    Promise.all([
      api.me().then(d => setUser(d.user)).catch(() => setUser(null)),
      api.getSettings().then(d => {
        if (d.settings?.branding) setBranding(b => ({ ...b, ...d.settings.branding }));
        setLandingPage(d.landingPage === true);
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
    // With the landing page on, logged-out visitors see it at `/` and sign in
    // at /login; any other admin path (a deep link) still goes to the login.
    if (landingPage && location.pathname === '/') {
      return <Suspense fallback={<Loading />}><Landing version={APP_VERSION} /></Suspense>;
    }
    return <Login backHref={landingPage ? '/' : null} onLogin={(u) => { setUser(u); navigate('/'); }} />;
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
  }

  const isAdmin = user.role === 'admin';

  return (
    <div className="admin-layout">
      <header className="admin-topbar">
        <span className="admin-topbar-brand"><LogoMark size={24} className="logo-mark" /><LogoWordmark /></span>
        <button
          className="admin-menu-toggle"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </header>
      {menuOpen && <div className="admin-sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`admin-sidebar${menuOpen ? ' open' : ''}`}>
        <h1><LogoMark size={28} className="logo-mark" /><LogoWordmark /></h1>
        <nav>
          <Link to="/" className={location.pathname === '/' || location.pathname.startsWith('/forms') ? 'active' : ''}>Forms</Link>
          <Link to="/analytics" className={location.pathname.startsWith('/analytics') ? 'active' : ''}>Analytics</Link>
          {isAdmin && (
            <>
              <div className="sidebar-section">Administration</div>
              <Link to="/users" className={location.pathname === '/users' ? 'active' : ''}>Users</Link>
              <Link to="/settings" className={location.pathname === '/settings' ? 'active' : ''}>Settings</Link>
              <Link to="/backup" className={location.pathname === '/backup' ? 'active' : ''}>Backup</Link>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <Link
            to="/account"
            className={`sidebar-account${location.pathname === '/account' ? ' active' : ''}`}
            title="Your account: password, two-factor login, sessions, API tokens"
          >
            <span className="sidebar-account-avatar" aria-hidden="true">{(user.email || '?').charAt(0).toUpperCase()}</span>
            <span className="sidebar-account-text">
              <span className="sidebar-account-email">{user.email}</span>
              <span className="sidebar-account-sub">Account{user.twoFactorEnabled ? ' · 2FA on' : ''}</span>
            </span>
            <span className="sidebar-account-chevron" aria-hidden="true">›</span>
          </Link>
          <div className="sidebar-footer-row">
            <button className="theme-toggle" onClick={cycleTheme}>
              <span className="theme-toggle-icon">{themeIcon}</span> {themeLabel}
            </button>
            <button className="sidebar-logout" onClick={handleLogout}>Log out</button>
          </div>
          <a href="https://github.com/vidual-labs/openflow" target="_blank" rel="noopener noreferrer" className="sidebar-version">
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
        {user.weakPassword && (
          <Alert type="error" style={{ marginBottom: 16 }}>
            Your account uses a weak or easily guessed password (such as the old default <code>admin123</code>).{' '}
            <Link to="/account">Change it now on your Account page</Link> — anyone who finds this install could otherwise log in as you.
          </Alert>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/forms/:id" element={<FormEditor />} />
          <Route path="/forms/:id/submissions" element={<Submissions />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/analytics/:formId" element={<FormAnalytics />} />
          <Route path="/users" element={isAdmin ? <Users /> : <Forbidden />} />
          <Route path="/settings" element={isAdmin ? <Settings /> : <Forbidden />} />
          <Route path="/backup" element={isAdmin ? <Backup /> : <Forbidden />} />
          <Route path="/account" element={<Account user={user} onUserChange={setUser} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
