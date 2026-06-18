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
 * OpenFlow brand mark — three flowing waves on the brand gradient tile.
 * Each instance gets a unique gradient id so multiple marks can coexist.
 */
export function LogoMark({ size = 28, className = '' }) {
  const uid = React.useId();
  const gradId = `of-grad-${uid}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6C5CE7" />
          <stop offset="1" stopColor="#A29BFE" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradId})`} />
      <path d="M6 12c3.2-3.4 6.6-3.4 10 0s6.8 3.4 10 0" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity="0.95" />
      <path d="M6 17c3.2-3.4 6.6-3.4 10 0s6.8 3.4 10 0" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity="0.75" />
      <path d="M6 22c3.2-3.4 6.6-3.4 10 0s6.8 3.4 10 0" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}
