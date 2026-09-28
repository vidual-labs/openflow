import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { formatServerDateTime } from '../utils/dates';
import { PageHeader, Alert, EmptyState, Loading } from '../components/AdminUI';
import { flattenFields } from '../utils/steps';

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

  async function handleDelete(subId) {
    if (!confirm('Delete this response? This cannot be undone.')) return;
    setDeleting(subId);
    try {
      await api.deleteSubmission(id, subId);
      setSubmissions(prev => prev.filter(s => s.id !== subId));
      setTotal(t => Math.max(0, t - 1));
    } catch (err) {
      setError(err.message || 'Failed to delete response');
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    api.getForm(id)
      .then(d => setForm(d.form))
      .catch(err => setError(err.message || 'Failed to load form'));
  }, [id]);

  useEffect(() => {
    api.getSubmissions(id, page)
      .then(d => {
        setSubmissions(d.submissions);
        setTotal(d.total);
      })
      .catch(err => setError(err.message || 'Failed to load submissions'));
  }, [id, page]);

  if (!form && !error) return <Loading />;

  // Flatten combined "group" steps so each underlying field gets its own column.
  const fields = flattenFields(form?.steps || []);
  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <PageHeader
        title={`Responses: ${form?.title || ''}`}
        subtitle={`${total} entries`}
        backTo={`/forms/${id}`}
        backLabel="← Back to form"
      >
        <a href={api.exportSubmissions(id)} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
          Export CSV
        </a>
      </PageHeader>

      <Alert type="error">{error}</Alert>

      {submissions.length === 0 ? (
        <EmptyState title="No responses yet" message="Publish and share your form to start collecting responses." />
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="table submissions-table">
              <thead>
                <tr>
                  <th>#</th>
                  {fields.map(s => <th key={s.id}>{s.label || s.question}</th>)}
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub, i) => (
                  <tr key={sub.id}>
                    <td style={{ color: 'var(--text-light)' }}>{(page - 1) * 20 + i + 1}</td>
                    {fields.map(s => (
                      <td key={s.id}>
                        {formatValue(sub.data[s.id], s)}
                      </td>
                    ))}
                    <td style={{ fontSize: 13, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>
                      {formatServerDateTime(sub.created_at)}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(sub.id)} disabled={deleting === sub.id}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}
