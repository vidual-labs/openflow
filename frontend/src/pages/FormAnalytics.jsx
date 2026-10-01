import React, { useState, useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, Alert, Loading } from '../components/AdminUI';
import {
  Delta, Kpi, todayUtc, addDays, rangeDays, formatDay, formatRange, formatPct, formatSeconds,
} from '../components/AnalyticsUI';

const PRESETS = ['7', '30', '90'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The before/after shortcut compares at most this many days on each side.
const SPLIT_MAX_DAYS = 90;

function validRange(from, to) {
  return DATE_RE.test(from || '') && DATE_RE.test(to || '') && from <= to;
}

// Everything the page shows is derived from the URL, so a comparison can be
// bookmarked or sent to a colleague and the back button undoes a change.
function useRanges(searchParams) {
  const today = todayUtc();
  const preset = searchParams.get('range') || '30';
  let period;
  if (preset === 'custom' && validRange(searchParams.get('from'), searchParams.get('to'))) {
    period = { from: searchParams.get('from'), to: searchParams.get('to') };
  } else {
    const n = PRESETS.includes(preset) ? Number(preset) : 30;
    period = { from: addDays(today, -(n - 1)), to: today };
  }
  const cmp = searchParams.get('cmp') || 'prev';
  let compare = null;
  if (cmp === 'prev') {
    const len = rangeDays(period.from, period.to);
    compare = { from: addDays(period.from, -len), to: addDays(period.from, -1) };
  } else if (cmp === 'custom' && validRange(searchParams.get('cfrom'), searchParams.get('cto'))) {
    compare = { from: searchParams.get('cfrom'), to: searchParams.get('cto') };
  }
  return { preset: preset === 'custom' ? 'custom' : PRESETS.includes(preset) ? preset : '30', period, cmp, compare };
}

export default function FormAnalytics() {
  const { formId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { preset, period, cmp, compare } = useRanges(searchParams);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const q = { from: period.from, to: period.to };
    if (compare) Object.assign(q, { compareFrom: compare.from, compareTo: compare.to });
    return q;
  }, [period.from, period.to, compare?.from, compare?.to]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getAnalyticsDetail(formId, query)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load analytics'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [formId, query]);

  function update(changes) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  function setPreset(value) {
    if (value === 'custom') update({ range: 'custom', from: period.from, to: period.to });
    else update({ range: value, from: null, to: null });
  }

  function setCmp(value) {
    if (value === 'custom') {
      const c = compare || { from: addDays(period.from, -rangeDays(period.from, period.to)), to: addDays(period.from, -1) };
      update({ cmp: 'custom', cfrom: c.from, cto: c.to });
    } else update({ cmp: value, cfrom: null, cto: null });
  }

  // "I changed the flow on day D": the days since D against as many days
  // right before it.
  function splitAt(day) {
    const today = todayUtc();
    if (!DATE_RE.test(day) || day > today) return;
    const to = rangeDays(day, today) > SPLIT_MAX_DAYS ? addDays(day, SPLIT_MAX_DAYS - 1) : today;
    const len = rangeDays(day, to);
    update({ range: 'custom', from: day, to, cmp: 'custom', cfrom: addDays(day, -len), cto: addDays(day, -1) });
  }

  if (!detail && loading) return <Loading label="Loading analytics…" />;
  if (!detail) {
    return (
      <div>
        <PageHeader title="Analytics" backTo="/analytics" backLabel="← All forms" />
        <Alert type="error">{error}</Alert>
      </div>
    );
  }

  const cur = detail.summary;
  const prev = detail.compare?.summary || null;

  return (
    <div className={loading ? 'analytics-loading' : undefined}>
      <PageHeader title={detail.title} subtitle="Form analytics" backTo="/analytics" backLabel="← All forms">
        <Link to={`/forms/${formId}`} className="btn btn-sm btn-secondary" style={{ textDecoration: 'none' }}>Edit form</Link>
        <Link to={`/forms/${formId}/submissions`} className="btn btn-sm btn-secondary" style={{ textDecoration: 'none' }}>Responses</Link>
      </PageHeader>

      <Alert type="error">{error}</Alert>

      <div className="card analytics-controls">
        <div className="analytics-control">
          <label htmlFor="an-period">Period</label>
          <div className="analytics-control-row">
            <select id="an-period" className="input" value={preset} onChange={e => setPreset(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom range</option>
            </select>
            {preset === 'custom' && (
              <DateRangeInputs range={period} onChange={r => update({ from: r.from, to: r.to })} label="Period" />
            )}
          </div>
        </div>
        <div className="analytics-control">
          <label htmlFor="an-compare">Compare with</label>
          <div className="analytics-control-row">
            <select id="an-compare" className="input" value={cmp} onChange={e => setCmp(e.target.value)}>
              <option value="prev">Previous period</option>
              <option value="custom">Custom range</option>
              <option value="none">No comparison</option>
            </select>
            {cmp === 'custom' && compare && (
              <DateRangeInputs range={compare} onChange={r => update({ cfrom: r.from, cto: r.to })} label="Comparison" />
            )}
          </div>
        </div>
        <SplitShortcut onSplit={splitAt} />
        <p className="analytics-ranges">
          <span className="range-chip range-a">{formatRange(detail.range)}</span>
          {detail.compare && <> vs. <span className="range-chip range-b">{formatRange(detail.compare.range)}</span></>}
          <span className="muted"> · days in UTC</span>
        </p>
      </div>

      <div className="kpi-grid">
        <Kpi label="Views" value={cur.views} sub={prev && `was ${prev.views}`}>
          {prev && <Delta kind="rel" value={cur.views} previous={prev.views} />}
        </Kpi>
        <Kpi label="Start rate" value={formatPct(cur.startRate)} sub={prev ? `was ${formatPct(prev.startRate)}` : `${cur.starts} visitors`}>
          {prev && <Delta value={cur.startRate} previous={prev.startRate} />}
        </Kpi>
        <Kpi label="Finish rate" value={formatPct(cur.completionRate)} sub={prev ? `was ${formatPct(prev.completionRate)}` : `${cur.completions} visitors`}>
          {prev && <Delta value={cur.completionRate} previous={prev.completionRate} />}
        </Kpi>
        <Kpi label="Conversion" value={formatPct(cur.conversionRate)} sub={prev ? `was ${formatPct(prev.conversionRate)}` : `${cur.completions} of ${cur.views} views`}>
          {prev && <Delta value={cur.conversionRate} previous={prev.conversionRate} />}
        </Kpi>
      </div>

      <StepTable current={detail.stepDropoff} compare={detail.compare?.stepDropoff || null} compareEntered={prev?.entered || 0} />

      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginBottom: 16 }}>Daily trend</h4>
        <DailyChart data={detail.daily} range={detail.range} />
      </div>
    </div>
  );
}

function DateRangeInputs({ range, onChange, label }) {
  // Only a complete, ordered pair reaches the URL; the inputs keep a
  // half-edited value meanwhile.
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  useEffect(() => { setFrom(range.from); setTo(range.to); }, [range.from, range.to]);
  function commit(f, t) {
    if (validRange(f, t)) onChange({ from: f, to: t });
  }
  return (
    <span className="date-range">
      <input type="date" className="input" aria-label={`${label} start`} value={from} max={to}
        onChange={e => { setFrom(e.target.value); commit(e.target.value, to); }} />
      <span className="muted">–</span>
      <input type="date" className="input" aria-label={`${label} end`} value={to} min={from}
        onChange={e => { setTo(e.target.value); commit(from, e.target.value); }} />
    </span>
  );
}

function SplitShortcut({ onSplit }) {
  const [day, setDay] = useState('');
  return (
    <div className="analytics-control analytics-split">
      <label htmlFor="an-split">Changed the flow?</label>
      <div className="analytics-control-row">
        <input id="an-split" type="date" className="input" value={day} max={todayUtc()} onChange={e => setDay(e.target.value)} />
        <button type="button" className="btn btn-sm btn-secondary" disabled={!day} onClick={() => onSplit(day)}>
          Compare before / after
        </button>
      </div>
      <span className="analytics-hint">Pick the day the change went live: the days since then are compared with as many days right before it.</span>
    </div>
  );
}

function StepTable({ current, compare, compareEntered }) {
  const rows = useMemo(() => {
    const byKey = new Map();
    for (const s of current) byKey.set(s.key, { key: s.key, a: s, b: null, order: s.order, stepIndex: s.stepIndex });
    for (const s of compare || []) {
      const row = byKey.get(s.key);
      if (row) row.b = s;
      else byKey.set(s.key, { key: s.key, a: null, b: s, order: s.order, stepIndex: s.stepIndex });
    }
    return [...byKey.values()].sort((x, y) => x.order - y.order || x.stepIndex - y.stepIndex);
  }, [current, compare]);

  const leak = current.reduce((max, s) => (s.dropped > 0 && (!max || s.dropped > max.dropped) ? s : max), null);
  const hasCompare = !!compare && compareEntered > 0;

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="analytics-card-head">
        <h4>Where visitors drop off</h4>
        <span className="muted">Each question in flow order. Steps hidden by conditions reach fewer visitors by design.</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ padding: '0 24px 24px' }}>No step data in this period yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table table-cards analytics-table step-table">
            <thead>
              <tr>
                <th>Step</th>
                <th className="num" title="Visitors who saw this step">Reached</th>
                <th className="num" title="Share of visitors who saw the first step and got this far">Reach</th>
                <th className="num" title="Share of visitors on this step who left the form here">Drop-off</th>
                <th className="num" title="Median time until visitors moved on from this step">Time on step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const s = row.a;
                const p = hasCompare ? row.b : null;
                return (
                  <tr key={row.key} className={!s ? 'step-row-missing' : undefined}>
                    <td className="cell-primary step-cell">
                      <div className="step-title">
                        <span className="step-num">{i + 1}</span>
                        <span>{(s || row.b).label}</span>
                        {s && leak && s.key === leak.key && <span className="tag tag-bad">Biggest drop-off</span>}
                        {s && hasCompare && !row.b && <span className="tag">New</span>}
                        {!s && <span className="tag">Only in comparison</span>}
                      </div>
                      <div className="reach-bar" aria-hidden="true">
                        {p && <div className="reach-bar-prev" style={{ width: `${p.reachRate}%` }} />}
                        <div className="reach-bar-cur" style={{ width: `${s ? s.reachRate : 0}%` }} />
                      </div>
                    </td>
                    <td data-label="Reached" className="num">
                      <Metric value={s?.sessions} prev={p?.sessions} format={v => v} />
                    </td>
                    <td data-label="Reach" className="num">
                      <Metric value={s?.reachRate} prev={p?.reachRate} format={formatPct} delta={{ good: 'up' }} />
                    </td>
                    <td data-label="Drop-off" className="num">
                      <Metric value={s?.dropRate} prev={p?.dropRate} format={formatPct} delta={{ good: 'down' }}
                        extra={s ? `${s.dropped} left` : null} />
                    </td>
                    <td data-label="Time on step" className="num">
                      <Metric value={s?.medianSeconds} prev={p?.medianSeconds} format={formatSeconds} delta={{ kind: 'secs', good: null }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="analytics-legend">
        <span><span className="swatch swatch-a" />This period</span>
        {hasCompare && <span><span className="swatch swatch-b" />Comparison</span>}
        <span className="muted">▲▼ change vs. the comparison (pp = percentage points); green is better.</span>
      </div>
    </div>
  );
}

function Metric({ value, prev, format, delta, extra }) {
  const has = value !== undefined && value !== null;
  const hasPrev = prev !== undefined && prev !== null;
  return (
    <div className="metric">
      <span className="metric-value">{has ? format(value) : '—'}</span>
      {delta && has && hasPrev && <Delta value={value} previous={prev} {...delta} />}
      {(hasPrev || extra) && (
        <span className="metric-sub">
          {extra}{extra && hasPrev ? ' · ' : ''}{hasPrev ? `was ${format(prev)}` : ''}
        </span>
      )}
    </div>
  );
}

function DailyChart({ data, range }) {
  // Every day of the range gets a slot, so quiet days show as gaps rather
  // than silently disappearing and squeezing the axis.
  const days = [];
  for (let d = range.from; d <= range.to && days.length < 400; d = addDays(d, 1)) {
    days.push({ day: d, views: 0, starts: 0, completions: 0 });
  }
  const byDay = Object.fromEntries(days.map(d => [d.day, d]));
  for (const row of data) {
    const d = byDay[row.day];
    if (!d) continue;
    if (row.event === 'view') d.views = row.sessions;
    if (row.event === 'start') d.starts = row.sessions;
    if (row.event === 'complete') d.completions = row.sessions;
  }
  const maxVal = Math.max(1, ...days.map(d => d.views));
  const total = days.reduce((n, d) => n + d.views, 0);

  if (total === 0) return <p className="muted">No visits in this period.</p>;

  return (
    <div>
      <div className="trend">
        <span className="trend-max">{maxVal}</span>
        <div className="trend-bars">
          {days.map(d => (
            <div key={d.day} className="trend-slot"
              title={`${formatDay(d.day)}\nViews: ${d.views}\nStarts: ${d.starts}\nCompletions: ${d.completions}${d.views ? `\nConversion: ${formatPct(Math.round((d.completions / d.views) * 1000) / 10)}` : ''}`}>
              <div className="trend-bar trend-views" style={{ height: `${(d.views / maxVal) * 100}%` }} />
              <div className="trend-bar trend-completions" style={{ height: `${(d.completions / maxVal) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="trend-axis">
        <span>{formatDay(days[0].day)}</span>
        <span>{formatDay(days[days.length - 1].day)}</span>
      </div>
      <div className="analytics-legend" style={{ padding: 0, marginTop: 8 }}>
        <span><span className="swatch swatch-views" />Views</span>
        <span><span className="swatch swatch-completions" />Completions</span>
      </div>
    </div>
  );
}
