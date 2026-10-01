import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, Alert, EmptyState, Loading } from '../components/AdminUI';
import { Delta, Kpi, formatPct } from '../components/AnalyticsUI';

export default function Analytics() {
  const navigate = useNavigate();
  const [forms, setForms] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getAnalyticsOverview(days)
      .then(d => setForms(d.forms))
      .catch(err => setError(err.message || 'Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [days]);

  const totals = forms.reduce((t, f) => ({
    views: t.views + f.views,
    starts: t.starts + f.starts,
    completions: t.completions + f.completions,
    prevViews: t.prevViews + f.previous.views,
    prevCompletions: t.prevCompletions + f.previous.completions,
  }), { views: 0, starts: 0, completions: 0, prevViews: 0, prevCompletions: 0 });
  const rate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  return (
    <div>
      <PageHeader title="Analytics" subtitle={`All forms, last ${days} days compared with the ${days} days before.`}>
        <select className="input" style={{ width: 'auto' }} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </PageHeader>

      <Alert type="error">{error}</Alert>

      {loading ? <Loading label="Loading analytics…" /> : forms.length === 0 ? (
        !error && <EmptyState title="No forms yet" message="Create and publish a form to start collecting analytics." />
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi label="Views" value={totals.views}><Delta kind="rel" value={totals.views} previous={totals.prevViews} /></Kpi>
            <Kpi label="Starts" value={totals.starts} />
            <Kpi label="Completions" value={totals.completions}><Delta kind="rel" value={totals.completions} previous={totals.prevCompletions} /></Kpi>
            <Kpi label="Conversion" value={formatPct(rate(totals.completions, totals.views))}>
              <Delta value={rate(totals.completions, totals.views)} previous={rate(totals.prevCompletions, totals.prevViews)} />
            </Kpi>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="table table-cards analytics-table">
                <thead>
                  <tr>
                    <th>Form</th>
                    <th className="num">Views</th>
                    <th className="num">Starts</th>
                    <th className="num">Completions</th>
                    <th className="num">Start rate</th>
                    <th className="num">Conversion</th>
                    <th className="num">vs. previous</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map(form => (
                    <tr key={form.id} className="row-link" onClick={() => navigate(`/analytics/${form.id}`)}>
                      <td className="cell-primary">
                        <Link to={`/analytics/${form.id}`} onClick={e => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}>
                          {form.title}
                        </Link>
                        {!form.published && <span className="badge badge-draft" style={{ marginLeft: 8 }}>Draft</span>}
                      </td>
                      <td data-label="Views" className="num">{form.views}</td>
                      <td data-label="Starts" className="num">{form.starts}</td>
                      <td data-label="Completions" className="num">{form.completions}</td>
                      <td data-label="Start rate" className="num">{formatPct(form.startRate)}</td>
                      <td data-label="Conversion" className="num"><strong>{formatPct(form.conversionRate)}</strong></td>
                      <td data-label="vs. previous" className="num">
                        {form.views || form.previous.views
                          ? <Delta value={form.conversionRate} previous={form.previous.conversionRate} />
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="analytics-note">
            Conversion = completions ÷ views. Open a form to see where visitors drop off and to compare periods,
            e.g. before and after you changed the flow.
          </p>
        </>
      )}
    </div>
  );
}
