import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

export default function Submissions() {
  const { id } = useParams();
  const [form, setForm] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.getForm(id).then(d => setForm(d.form));
  }, [id]);

  useEffect(() => {
    api.getSubmissions(id, page).then(d => {
      setSubmissions(d.submissions);
      setTotal(d.total);
    });
  }, [id, page]);

  if (!form) return <div>Laden...</div>;

  const steps = form.steps || [];
  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Link to={`/forms/${id}`} style={{ color: '#636E72', textDecoration: 'none', fontSize: 13 }}>&larr; Zurueck zum Formular</Link>
          <h2 style={{ marginTop: 8 }}>Antworten: {form.title}</h2>
          <p style={{ color: '#636E72', fontSize: 14 }}>{total} Eintraege</p>
        </div>
        <a href={api.exportSubmissions(id)} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
          CSV exportieren
        </a>
      </div>

      {submissions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <h3>Noch keine Antworten</h3>
          <p style={{ color: '#636E72' }}>Veroeffentlichen und teilen Sie Ihr Formular, um Antworten zu erhalten.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  {steps.map(s => <th key={s.id}>{s.label || s.question}</th>)}
                  <th>Datum</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub, i) => (
                  <tr key={sub.id}>
                    <td style={{ color: '#636E72' }}>{(page - 1) * 20 + i + 1}</td>
                    {steps.map(s => (
                      <td key={s.id}>
                        {Array.isArray(sub.data[s.id]) ? sub.data[s.id].join(', ') : String(sub.data[s.id] ?? '-')}
                      </td>
                    ))}
                    <td style={{ fontSize: 13, color: '#636E72', whiteSpace: 'nowrap' }}>
                      {new Date(sub.created_at).toLocaleString('de')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
              <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurueck</button>
              <span style={{ padding: '6px 12px', fontSize: 14 }}>Seite {page} von {totalPages}</span>
              <button className="btn btn-sm btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Weiter</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
