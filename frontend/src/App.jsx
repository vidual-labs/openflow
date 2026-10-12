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
import { LogoMark, LogoWordmark, Loading, EmptyState, Alert, PageNoticeContext } from './components/AdminUI';
import { version as APP_VERSION } from '../package.json';

// Only fetched when OPENFLOW_LANDING_PAGE is on, so the admin bundle doesn't
// carry the marketing page's code and styles.
const Landing = lazy(() => import('./pages/Landing'));

function getInitialTheme() {
  return localStorage.getItem('of_theme') || 'auto';
}

const THEMES = [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']];

// Menu items: path, label, glyph, and whether a path counts as "this item".
// The glyphs carry U+FE0E so platforms that would draw an emoji draw text.
function NavItem({ to, label, glyph, active }) {
  return (
    <Link to={to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
      <span className="nav-glyph" aria-hidden="true">{glyph}</span>
      {label}
    </Link>
  );
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
  const path = location.pathname;

  // Rendered by each page right under its header (see PageHeader).
  const pageNotice = user.weakPassword ? (
    <Alert type="warning">
      <strong>Weak password.</strong> Your account uses a weak or easily guessed password (such as the old default <code>admin123</code>).{' '}
      <Link to="/account">Change it on your Account page</Link> — anyone who finds this install could otherwise log in as you.
    </Alert>
  ) : null;

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
          <NavItem to="/" label="Forms" glyph={'\u25A4\uFE0E'} active={path === '/' || path.startsWith('/forms')} />
          <NavItem to="/analytics" label="Analytics" glyph={'\u2197\uFE0E'} active={path.startsWith('/analytics')} />
          {isAdmin && (
            <>
              <div className="sidebar-section">Administration</div>
              <NavItem to="/users" label="Users" glyph={'\u25CE\uFE0E'} active={path === '/users'} />
              <NavItem to="/settings" label="Settings" glyph={'\u2699\uFE0E'} active={path === '/settings'} />
              <NavItem to="/backup" label="Backup" glyph={'\u2913\uFE0E'} active={path === '/backup'} />
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
            <div className="theme-switch" role="group" aria-label="Colour theme">
              {THEMES.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>{label}</button>
              ))}
            </div>
            <button className="sidebar-logout" onClick={handleLogout}>Log out</button>
          </div>
          <a href="https://github.com/vidual-labs/openflow" target="_blank" rel="noopener noreferrer" className="sidebar-version">
            {branding.logoVisible && (
              <img
                src={branding.logoUrl || '/vidual-logo.png'}
                alt="Logo"
                style={{ height: 18, opacity: 0.45, display: 'block', marginBottom: 6, maxWidth: 120, objectFit: 'contain' }}
              />
            )}
            v{APP_VERSION} &middot; GitHub
          </a>
        </div>
      </aside>
      <main className="admin-main">
        <PageNoticeContext.Provider value={pageNotice}>
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
        </PageNoticeContext.Provider>
      </main>
    </div>
  );
}
