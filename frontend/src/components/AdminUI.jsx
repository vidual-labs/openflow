import React from 'react';
import { Link } from 'react-router';
import { api, setReauthHandler } from '../api';

/**
 * Shared admin UI primitives. These replace the ad-hoc inline blocks that were
 * duplicated (and had drifted) across the admin pages: page headers, alert
 * banners, loading and empty states. Keeping them here ensures one consistent
 * look and a single place to restyle.
 */

/**
 * Account-wide notice (the weak-password warning) that App provides and every
 * page header renders right below itself — under the title rather than above
 * it, so it never pushes the title out of line with the sidebar.
 */
export const PageNoticeContext = React.createContext(null);

export function PageNotice() {
  return React.useContext(PageNoticeContext);
}

/**
 * Page header: a 20px breadcrumb row (always present, so every title lines up
 * with the first sidebar item), the title, an optional subtitle and the
 * actions. `backTo`/`backLabel` render the breadcrumb's link, `crumb` the
 * current page after it; `eyebrow` is plain text for pages without a parent.
 */
export function PageHeader({ title, subtitle, backTo, backLabel = '← Back', crumb, eyebrow, children }) {
  return (
    <>
      <div className="page-header">
        <div className="page-header-titles">
          <div className="page-crumb">
            {backTo && <Link to={backTo} className="back-link">{backLabel}</Link>}
            {backTo && crumb && <span className="page-crumb-sep">/</span>}
            {crumb && <span className="page-crumb-current">{crumb}</span>}
            {!backTo && !crumb && eyebrow}
          </div>
          <h2>{title}</h2>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {children && <div className="page-header-actions">{children}</div>}
      </div>
      <PageNotice />
    </>
  );
}

export function Alert({ type = 'error', children, style }) {
  if (!children) return null;
  return <div className={`alert alert-${type}`} style={style}>{children}</div>;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading-state">{label}</div>;
}

export function EmptyState({ title, message, children }) {
  return (
    <div className="card empty-state">
      {title && <h3>{title}</h3>}
      {message && <p>{message}</p>}
      {children}
    </div>
  );
}

/**
 * "Sudo mode" prompt. Mounted once by the admin shell (App.jsx), it registers
 * itself with api.js: when a guarded action (backup download/restore, user
 * management, creating an API token) answers 403 `reauth_required`, it asks
 * for the password, confirms it with POST /api/auth/confirm-password, and the
 * original request is retried once. Cancel aborts that action. Accounts with
 * two-factor login confirm with their password only.
 */
export function ReauthDialog() {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const resolveRef = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    setReauthHandler(() => new Promise((resolve) => {
      resolveRef.current = resolve;
      setPassword('');
      setError('');
      setOpen(true);
    }));
    return () => {
      setReauthHandler(null);
      if (resolveRef.current) resolveRef.current(false);
      resolveRef.current = null;
    };
  }, []);

  function finish(confirmed) {
    setOpen(false);
    setPassword('');
    setError('');
    const resolve = resolveRef.current;
    resolveRef.current = null;
    if (resolve) resolve(confirmed);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.confirmPassword(password);
      finish(true);
    } catch (err) {
      setPassword('');
      setError(err.message || 'That password is not correct.');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="reauth-backdrop" onKeyDown={(e) => { if (e.key === 'Escape') finish(false); }}>
      <form
        className="card reauth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        aria-describedby="reauth-desc"
        onSubmit={handleSubmit}
      >
        <h3 id="reauth-title">Confirm your password</h3>
        <p id="reauth-desc" className="reauth-text">
          This action needs your password. Once confirmed, you won't be asked again for 10 minutes in this session.
        </p>
        <div className="input-group">
          <label htmlFor="reauth-password">Password</label>
          <input
            id="reauth-password"
            ref={inputRef}
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Alert type="error">{error}</Alert>
        <div className="reauth-actions">
          <button type="button" className="btn btn-secondary" onClick={() => finish(false)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * OpenFlow brand mark — one continuous stroke that forms an "O" and flows out
 * into a wave, on the purple → teal brand gradient. The same mark as
 * `docs/assets/openflow-mark.svg` and `public/favicon.svg`. `size` is the
 * height; the mark is wider than tall (90 × 64). Each instance gets a unique
 * gradient id so multiple marks can coexist on one page.
 */
export const LOGO_MARK_RATIO = 90 / 64;

export function LogoMark({ size = 28, className = '' }) {
  const uid = React.useId();
  const gradId = `of-grad-${uid}`;
  return (
    <svg
      className={className}
      width={Math.round(size * LOGO_MARK_RATIO)}
      height={size}
      viewBox="0 0 90 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="10" y1="0" x2="88" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6C5CE7" />
          <stop offset="1" stopColor="#00CEC9" />
        </linearGradient>
      </defs>
      <path
        d="M83.5 30.5c-10-2-10 12-18 12s-10-12-16-20A20 20 0 1 0 49.5 41.5"
        stroke={`url(#${gradId})`}
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The "OpenFlow" wordmark as text: "Open" in the surrounding text colour,
 * "Flow" on the brand gradient (see `.logo-word` in global.css). Pair it with
 * <LogoMark /> inside a flex container.
 */
export function LogoWordmark() {
  return (
    <span className="logo-word">Open<span className="logo-word-flow">Flow</span></span>
  );
}
