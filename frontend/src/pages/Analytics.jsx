import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, Alert, EmptyState, Loading } from '../components/AdminUI';

export default function Analytics() {
  const [forms, setForms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
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

  useEffect(() => {
    if (selected) {
      api.getAnalyticsDetail(selected, days)
        .then(d => setDetail(d))
        .catch(() => setDetail(null));
    } else {
      setDetail(null);
    }
  }, [selected, days]);

  if (loading) return <Loading label="Loading analytics…" />;

  return (
    <div>
      <PageHeader title="Analytics">
        <select className="input" style={{ width: 'auto' }} value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </PageHeader>

      <Alert type="error">{error}</Alert>

      {/* Overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
        {forms.map(form => (
          <div
            key={form.id}
            className="card"
            style={{ cursor: 'pointer', border: selected === form.id ? '2px solid var(--primary)' : '2px solid transparent', transition: 'border-color 0.2s' }}
            onClick={() => setSelected(selected === form.id ? null : form.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, margin: 0 }}>{form.title}</h3>
              <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>{form.conversionRate}%</span>
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 14 }}>
              <div>
                <div style={{ color: 'var(--text-light)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Views</div>
                <div style={{ fontWeight: 600, fontSize: 20 }}>{form.views}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-light)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Starts</div>
                <div style={{ fontWeight: 600, fontSize: 20 }}>{form.starts}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-light)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Completions</div>
                <div style={{ fontWeight: 600, fontSize: 20 }}>{form.completions}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {forms.length === 0 && !error && (
        <EmptyState title="No analytics data yet" message="Publish a form and share it to start collecting analytics." />
      )}

      {/* Detail view */}
      {detail && (
        <div>
          <h3 style={{ marginBottom: 16 }}>{detail.title} — Detailed Analytics</h3>

          {/* Funnel */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 16 }}>Conversion Funnel</h4>
            <FunnelBar label="Views" value={detail.summary.views} max={detail.summary.views} color="var(--primary)" />
            <FunnelBar label="Started" value={detail.summary.starts} max={detail.summary.views} color="#0984E3" />
            <FunnelBar label="Completed" value={detail.summary.completions} max={detail.summary.views} color="var(--success)" />
            <div style={{ display: 'flex', gap: 24, marginTop: 16, fontSize: 14, color: 'var(--text-light)' }}>
              <span>Start Rate: <strong>{detail.summary.startRate}%</strong></span>
              <span>Conversion: <strong>{detail.summary.conversionRate}%</strong></span>
            </div>
          </div>

          {/* Step drop-off */}
          {detail.stepDropoff.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 16 }}>Step Drop-off</h4>
              {detail.stepDropoff.map((step, i) => (
                <FunnelBar
                  key={step.stepIndex}
                  label={`${i + 1}. ${step.label}`}
                  value={step.sessions}
                  max={detail.stepDropoff[0]?.sessions || 1}
                  color={i === detail.stepDropoff.length - 1 ? 'var(--success)' : 'var(--primary)'}
                />
              ))}
            </div>
          )}

          {/* Daily trend */}
          {detail.daily.length > 0 && (
            <div className="card">
              <h4 style={{ marginBottom: 16 }}>Daily Trend</h4>
              <DailyChart data={detail.daily} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FunnelBar({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>{value}</span>
      </div>
      <div style={{ height: 8, background: 'rgba(0,0,0,0.06)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

function DailyChart({ data }) {
  // Group by day
  const days = {};
  data.forEach(d => {
    if (!days[d.day]) days[d.day] = { views: 0, starts: 0, completions: 0 };
    if (d.event === 'view') days[d.day].views = d.sessions;
    if (d.event === 'start') days[d.day].starts = d.sessions;
    if (d.event === 'complete') days[d.day].completions = d.sessions;
  });

  const dayKeys = Object.keys(days).sort();
  const maxVal = Math.max(...dayKeys.map(d => days[d].views || 1), 1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, marginBottom: 8 }}>
        {dayKeys.map(day => {
          const d = days[day];
          return (
            <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }} title={`${day}\nViews: ${d.views}\nStarts: ${d.starts}\nCompletions: ${d.completions}`}>
              <div style={{ width: '100%', maxWidth: 24, background: 'var(--primary)', borderRadius: '3px 3px 0 0', height: `${(d.views / maxVal) * 100}%`, minHeight: d.views > 0 ? 4 : 0, opacity: 0.3 }} />
              <div style={{ width: '100%', maxWidth: 24, background: 'var(--success)', borderRadius: '3px 3px 0 0', height: `${(d.completions / maxVal) * 100}%`, minHeight: d.completions > 0 ? 4 : 0, marginTop: -1 * ((d.views / maxVal) * 100) + '%', position: 'relative' }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-light)' }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--primary)', borderRadius: 2, marginRight: 4, opacity: 0.3 }} />Views</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--success)', borderRadius: 2, marginRight: 4 }} />Completions</span>
      </div>
    </div>
  );
}
