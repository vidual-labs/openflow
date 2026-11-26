import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import { api } from '../api';
import { formatServerDateTime } from '../utils/dates';
import { PageHeader, Alert, EmptyState, Loading } from '../components/AdminUI';
import { flattenFields } from '../utils/steps';
import SubmissionDetail, { hasGoogleAdsClick } from '../components/SubmissionDetail';

const PAGE_SIZE = 20;
const NONE = '__none__';
const NO_FILTERS = { utm_source: '', utm_medium: '', utm_campaign: '', google_ads_click: '' };
const TRACKING_COLUMNS_KEY = 'of_responses_tracking_columns';

function readTrackingColumns() {
  try { return localStorage.getItem(TRACKING_COLUMNS_KEY) === '1'; } catch { return false; }
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="resp-filter">
      <span>{label}</span>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function formatValue(val, step) {
  if (step.type === 'address' && val && typeof val === 'object') {
    const parts = [val.street, val.postalCode, val.city, val.country].filter(Boolean);
    const customParts = (step.customFields || []).map(f => val[f.id]).filter(Boolean);
    if (customParts.length) parts.push(`(${customParts.join(', ')})`);
    return parts.join(', ') || '-';
  }
  if (Array.isArray(val)) return val.join(', ');
  // File Upload stores { name, type, size, data: <base64 data URL> } — show
  // the name and size, never the encoded file.
  if (val && typeof val === 'object' && typeof val.name === 'string' && typeof val.data === 'string') {
    // Same B / KB / MB steps as the CSV export (backend utils/formatValue.js).
    const size = Number(val.size);
    let sizeText = '';
    if (Number.isFinite(size) && size >= 0) {
      if (size < 1024) sizeText = ` (${size} B)`;
      else if (size < 1024 * 1024) sizeText = ` (${(size / 1024).toFixed(1)} KB)`;
      else sizeText = ` (${(size / (1024 * 1024)).toFixed(1)} MB)`;
    }
    return `${val.name}${sizeText}`;
  }
  if (val && typeof val === 'object') return JSON.stringify(val);
  return String(val ?? '-');
}

export default function Submissions() {
  const { id } = useParams();
  const [form, setForm] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [filterValues, setFilterValues] = useState({ utm_source: [], utm_medium: [], utm_campaign: [] });
  const [showTracking, setShowTracking] = useState(readTrackingColumns);
  const [selected, setSelected] = useState(null);
  // Bumped after a delete so the page is fetched again: the next page's first
  // response moves up, and a page left empty steps back one.
  const [reloadKey, setReloadKey] = useState(0);

  const filtered = Object.values(filters).some(Boolean);

  async function handleDelete(subId) {
    if (!confirm('Delete this response? This cannot be undone.')) return;
    setDeleting(subId);
    try {
      await api.deleteSubmission(id, subId);
      setSubmissions(prev => prev.filter(s => s.id !== subId));
      setTotal(t => Math.max(0, t - 1));
      setReloadKey(k => k + 1);
      setSelected(sel => (sel && sel.id === subId ? null : sel));
    } catch (err) {
      setError(err.message || 'Failed to delete response');
    } finally {
      setDeleting(null);
    }
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(1);
  }

  function toggleTracking(on) {
    setShowTracking(on);
    try { localStorage.setItem(TRACKING_COLUMNS_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  }

  useEffect(() => {
    api.getForm(id)
      .then(d => setForm(d.form))
      .catch(err => setError(err.message || 'Failed to load form'));
  }, [id]);

  useEffect(() => {
    api.getSubmissionFilters(id)
      .then(d => setFilterValues(d.values))
      .catch(() => {});
  }, [id, reloadKey]);

  useEffect(() => {
    api.getSubmissions(id, page, filters)
      .then(d => {
        // Deleting the last response on a later page left it empty, showing
        // "No responses yet" while there still were some.
        if (d.submissions.length === 0 && d.total > 0 && page > 1) {
          setPage(Math.max(1, Math.ceil(d.total / PAGE_SIZE)));
          return;
        }
        setSubmissions(d.submissions);
        setTotal(d.total);
      })
      .catch(err => setError(err.message || 'Failed to load submissions'));
  }, [id, page, reloadKey, filters]);

  if (!form && !error) return <Loading />;

  // Flatten combined "group" steps so each underlying field gets its own column.
  const fields = flattenFields(form?.steps || []);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const utmOptions = (key) => (
    <>
      <option value="">All</option>
      <option value={NONE}>(none)</option>
      {(filterValues[key] || []).map(v => <option key={v} value={v}>{v}</option>)}
    </>
  );

  return (
    <div>
      <PageHeader
        title={`Responses: ${form?.title || ''}`}
        subtitle={filtered ? `${total} matching entries` : `${total} entries`}
        backTo={`/forms/${id}`}
        backLabel="← Back to form"
      >
        <a href={api.exportSubmissions(id, filters)} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
          {filtered ? 'Export filtered CSV' : 'Export CSV'}
        </a>
      </PageHeader>

      <Alert type="error">{error}</Alert>

      <div className="card resp-filters">
        <FilterSelect label="Source" value={filters.utm_source} onChange={v => setFilter('utm_source', v)}>{utmOptions('utm_source')}</FilterSelect>
        <FilterSelect label="Medium" value={filters.utm_medium} onChange={v => setFilter('utm_medium', v)}>{utmOptions('utm_medium')}</FilterSelect>
        <FilterSelect label="Campaign" value={filters.utm_campaign} onChange={v => setFilter('utm_campaign', v)}>{utmOptions('utm_campaign')}</FilterSelect>
        <FilterSelect label="Google Ads click" value={filters.google_ads_click} onChange={v => setFilter('google_ads_click', v)}>
          <option value="">All</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </FilterSelect>
        <div className="resp-filters-end">
          {filtered && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Clear filters</button>
          )}
          <label className="resp-toggle">
            <input type="checkbox" checked={showTracking} onChange={e => toggleTracking(e.target.checked)} />
            Tracking columns
          </label>
        </div>
      </div>

      {submissions.length === 0 ? (
        filtered
          ? <EmptyState title="No matching responses" message="No response matches these filters." />
          : <EmptyState title="No responses yet" message="Publish and share your form to start collecting responses." />
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="table submissions-table">
              <thead>
                <tr>
                  <th>#</th>
                  {fields.map(s => <th key={s.id} title={s.key ? `Key: ${s.key}` : undefined}>{s.label || s.question}</th>)}
                  {showTracking && (
                    <>
                      <th>Source / Medium / Campaign</th>
                      <th>Google Ads click</th>
                    </>
                  )}
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub, i) => {
                  const m = sub.metadata || {};
                  const utm = [m.utm_source, m.utm_medium, m.utm_campaign].map(v => v || '—').join(' / ');
                  return (
                    <tr key={sub.id}>
                      <td style={{ color: 'var(--text-light)' }}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                      {fields.map(s => (
                        <td key={s.id}>
                          {formatValue(sub.data[s.id], s)}
                        </td>
                      ))}
                      {showTracking && (
                        <>
                          <td>{m.utm_source || m.utm_medium || m.utm_campaign ? utm : <span style={{ color: 'var(--text-light)' }}>—</span>}</td>
                          <td>{hasGoogleAdsClick(m) ? 'Yes' : <span style={{ color: 'var(--text-light)' }}>No</span>}</td>
                        </>
                      )}
                      <td style={{ fontSize: 13, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>
                        {formatServerDateTime(sub.created_at)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => setSelected(sub)} style={{ marginRight: 6 }}>
                          Details
                        </button>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(sub.id)} disabled={deleting === sub.id}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
              <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span style={{ padding: '6px 12px', fontSize: 14 }}>Page {page} of {totalPages}</span>
              <button className="btn btn-sm btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {selected && (
        <SubmissionDetail
          formId={id}
          submission={selected}
          fields={fields}
          formatValue={formatValue}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
