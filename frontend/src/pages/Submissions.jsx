import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
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
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  {fields.map(s => <th key={s.id}>{s.label || s.question}</th>)}
                  <th>Date</th>
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
                      {new Date(sub.created_at).toLocaleString('en')}
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
