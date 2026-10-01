import React from 'react';

// Analytics ranges are whole UTC days ('YYYY-MM-DD', both ends inclusive),
// matching the server's datetime('now') timestamps.
const DAY_MS = 86400000;

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

// Inclusive length of a range in days.
export function rangeDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export function formatDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatRange(range) {
  if (!range) return '';
  return range.from === range.to ? formatDay(range.from) : `${formatDay(range.from)} – ${formatDay(range.to)}`;
}

export function formatPct(value) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function formatSeconds(secs) {
  if (secs === null || secs === undefined) return '—';
  if (secs < 60) return `${Math.round(secs)} s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

// A change against a comparison value. `kind`: 'pp' (difference of two
// percentages), 'rel' (relative change of a count) or 'secs'. `good` says
// which direction is an improvement ('up', 'down', or null for neutral), so
// a rising drop-off reads red and a rising conversion green.
export function Delta({ value, previous, kind = 'pp', good = 'up' }) {
  if (previous === null || previous === undefined || value === null || value === undefined) return null;
  let diff = value - previous;
  let text;
  if (kind === 'rel') {
    if (previous === 0) return value === 0 ? <span className="delta delta-flat">±0</span> : <span className="delta delta-flat">new</span>;
    diff = ((value - previous) / previous) * 100;
    text = `${Math.abs(Math.round(diff))}%`;
  } else if (kind === 'secs') {
    text = formatSeconds(Math.abs(diff));
  } else {
    text = `${Math.abs(diff) < 10 ? Math.abs(diff).toFixed(1) : Math.round(Math.abs(diff))} pp`;
  }
  const rounded = kind === 'rel' ? Math.round(diff) : kind === 'secs' ? Math.round(diff) : Math.round(diff * 10) / 10;
  // An unchanged time is noise next to every step; an unchanged rate is news.
  if (rounded === 0) return kind === 'secs' ? null : <span className="delta delta-flat">±0</span>;
  const up = rounded > 0;
  const tone = !good ? 'flat' : (up === (good === 'up') ? 'good' : 'bad');
  return (
    <span className={`delta delta-${tone}`} title={kind === 'pp' ? 'Percentage points' : undefined}>
      {up ? '▲' : '▼'} {text}
    </span>
  );
}

export function Kpi({ label, value, sub, children }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {(children || sub) && <div className="kpi-sub">{children}{sub && <span className="muted">{sub}</span>}</div>}
    </div>
  );
}
