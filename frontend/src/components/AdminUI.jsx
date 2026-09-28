import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Shared admin UI primitives. These replace the ad-hoc inline blocks that were
 * duplicated (and had drifted) across the admin pages: page headers, alert
 * banners, loading and empty states. Keeping them here ensures one consistent
 * look and a single place to restyle.
 */

export function PageHeader({ title, subtitle, backTo, backLabel = '← Back', children }) {
  return (
    <div className="page-header">
      <div className="page-header-titles">
        {backTo && <Link to={backTo} className="back-link">{backLabel}</Link>}
        <h2>{title}</h2>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </div>
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
