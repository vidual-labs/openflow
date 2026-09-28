// Turns a stored answer into the one plain string every text consumer
// (CSV export, the e-mail table, Google Sheets cells) should show.
//
// Most answers are already strings (dates, timeslots and ranges are stored
// as plain text on purpose — see CLAUDE.md). Two field types store objects:
//   - Address:     { street, postalCode, city, country, <custom field id>: … }
//   - File Upload: { name, type, size, data: <base64 data URL> }
// Stringifying those naively yields "[object Object]" (CSV) or dumps a
// multi-megabyte base64 blob into an e-mail / spreadsheet cell.

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAddress(field, val) {
  const parts = [val.street, val.postalCode, val.city, val.country]
    .map(p => (p == null ? '' : String(p).trim()))
    .filter(Boolean);
  const customParts = (field.customFields || [])
    .map(f => val[f.id])
    .map(p => (p == null ? '' : String(p).trim()))
    .filter(Boolean);
  if (customParts.length) parts.push(`(${customParts.join(', ')})`);
  return parts.join(', ');
}

function formatValue(field, val) {
  if (val === undefined || val === null) return '';
  if (Array.isArray(val)) return val.map(v => formatValue(field, v)).filter(Boolean).join(', ');
  if (typeof val === 'object') {
    if (field && field.type === 'address') return formatAddress(field, val);
    if (typeof val.name === 'string' && typeof val.data === 'string') {
      const size = formatFileSize(val.size);
      return size ? `${val.name} (${size})` : val.name;
    }
    if (field && field.type === 'file-upload' && typeof val.name === 'string') {
      return val.name;
    }
    return JSON.stringify(val);
  }
  return String(val);
}

module.exports = { formatValue, formatFileSize };
