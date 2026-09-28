// SQLite's datetime('now') rows come back as 'YYYY-MM-DD HH:MM:SS' in UTC
// with no zone marker. V8 parses that form as *local* time (shifting every
// timestamp by the viewer's UTC offset) and Safari rejects it outright
// ("Invalid Date"), so mark it as UTC and use the ISO 'T' separator. Full
// ISO strings (submission metadata) pass through untouched.
export function parseServerDate(value) {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || !value) return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/);
  const d = new Date(m ? `${m[1]}T${m[2]}${m[3] || ''}Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatServerDate(value, locale) {
  const d = parseServerDate(value);
  return d ? d.toLocaleDateString(locale) : '—';
}

export function formatServerDateTime(value, locale) {
  const d = parseServerDate(value);
  return d ? d.toLocaleString(locale) : '—';
}
