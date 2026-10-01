const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A custom range longer than this is almost certainly a typo, and it would
// pull every event of a busy form into memory for the per-session walk.
const MAX_RANGE_DAYS = 400;

// analytics_events.created_at is SQLite's datetime('now') text
// ('YYYY-MM-DD HH:MM:SS'); the window bound must use the same format, since
// an ISO string ('...T...Z') sorts after every same-day row and silently
// dropped the window's first day.
function toSqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function sinceSql(days) {
  return toSqlTime(Date.now() - days * DAY_MS);
}

function parseDay(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : ms;
}

// A window over created_at: [since, until). `from`/`to` are whole UTC days
// (both inclusive); without them it is the rolling last `days` days.
// Returns { error } for a malformed custom range.
function resolveRange(from, to, days) {
  if (from === undefined && to === undefined) {
    const n = Math.min(Math.max(parseInt(days) || 30, 1), MAX_RANGE_DAYS);
    return {
      since: sinceSql(n),
      until: null,
      from: toSqlTime(Date.now() - n * DAY_MS).slice(0, 10),
      to: toSqlTime(Date.now()).slice(0, 10),
      days: n,
    };
  }
  const fromMs = parseDay(from);
  const toMs = parseDay(to);
  if (fromMs === null || toMs === null) return { error: 'Dates must be YYYY-MM-DD' };
  if (toMs < fromMs) return { error: 'The range ends before it starts' };
  const n = Math.round((toMs - fromMs) / DAY_MS) + 1;
  if (n > MAX_RANGE_DAYS) return { error: `A range can span at most ${MAX_RANGE_DAYS} days` };
  return { since: toSqlTime(fromMs), until: toSqlTime(toMs + DAY_MS), from, to, days: n };
}

function rangeSql(range) {
  return range.until ? 'created_at >= ? AND created_at < ?' : 'created_at >= ?';
}

function rangeArgs(range) {
  return range.until ? [range.since, range.until] : [range.since];
}

// One decimal, so a before/after delta of a few tenths of a point still shows.
function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function eventCounts(db, formIds, range) {
  const placeholders = formIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT form_id, event, COUNT(DISTINCT session_id) as sessions
    FROM analytics_events
    WHERE form_id IN (${placeholders}) AND ${rangeSql(range)}
    GROUP BY form_id, event
  `).all(...formIds, ...rangeArgs(range));
}

function summarize(counts) {
  const get = event => counts.find(c => c.event === event)?.sessions || 0;
  const views = get('view');
  const starts = get('start');
  const completions = get('complete');
  return {
    views,
    starts,
    completions,
    conversionRate: pct(completions, views),
    startRate: pct(starts, views),
    completionRate: pct(completions, starts),
  };
}

function stepKey(stepId, stepIndex) {
  return stepId || `idx:${stepIndex}`;
}

// Per-step reach, drop-off and time on step, from each session's own ordered
// step events. Keyed by step *id*, not index: the renderer reports its
// position in the conditionally filtered flow, so the same index can be
// different questions for different visitors. Rows without a step id (events
// from before ids were recorded) still fall back to the index.
//
// - reached: sessions that saw the step at least once.
// - dropped: sessions whose last step was this one and that never completed.
// - time on step: seconds from entering the step to the next step (or the
//   completion), summed over revisits within a session; a session that left
//   the form on this step has no time for it.
function stepStats(db, formId, range) {
  const rows = db.prepare(`
    SELECT session_id, event, step_index, step_id, created_at
    FROM analytics_events
    WHERE form_id = ? AND ${rangeSql(range)} AND session_id IS NOT NULL
      AND (event = 'complete' OR (event = 'step' AND step_index IS NOT NULL))
    ORDER BY session_id, created_at, id
  `).all(formId, ...rangeArgs(range));

  const stats = new Map();
  const statFor = (key, row) => {
    let s = stats.get(key);
    if (!s) {
      s = { stepId: row.step_id, stepIndex: row.step_index, reached: 0, dropped: 0, durations: [] };
      stats.set(key, s);
    }
    s.stepIndex = Math.min(s.stepIndex, row.step_index);
    return s;
  };

  let entered = 0;
  let i = 0;
  while (i < rows.length) {
    const sessionId = rows[i].session_id;
    const seen = new Set();
    const timeOn = new Map();
    let current = null;
    let completed = false;
    for (; i < rows.length && rows[i].session_id === sessionId; i++) {
      const row = rows[i];
      const t = Date.parse(row.created_at.replace(' ', 'T') + 'Z');
      if (current) {
        const key = row.event === 'complete' ? null : stepKey(row.step_id, row.step_index);
        if (key === current.key) continue; // a re-render of the same step
        timeOn.set(current.key, (timeOn.get(current.key) || 0) + (t - current.at) / 1000);
      }
      if (row.event === 'complete') {
        completed = true;
        current = null;
        continue;
      }
      const key = stepKey(row.step_id, row.step_index);
      const s = statFor(key, row);
      if (!seen.has(key)) {
        seen.add(key);
        s.reached++;
      }
      current = { key, at: t };
    }
    if (seen.size) entered++;
    if (current && !completed) stats.get(current.key).dropped++;
    for (const [key, secs] of timeOn) stats.get(key).durations.push(secs);
  }

  return { entered, stats };
}

function stepLabel(step, stepId, stepIndex) {
  // The GDPR consent is a step of its own at the end of the flow, but it isn't
  // in the form's configured steps — name it rather than showing "Step 8".
  if (stepId === '__consent__') return 'Consent';
  if (!step) return stepId ? `Removed step (was #${stepIndex + 1})` : `Step ${stepIndex + 1}`;
  if (step.type === 'group' && Array.isArray(step.fields)) {
    return step.fields.map(f => f.label || f.question).filter(Boolean).join(' + ') || `Step ${stepIndex + 1}`;
  }
  return step.label || step.question || `Step ${stepIndex + 1}`;
}

function stepRows(steps, { entered, stats }) {
  return [...stats.entries()].map(([key, s]) => {
    const configuredIndex = s.stepId ? steps.findIndex(st => st && st.id === s.stepId) : -1;
    const step = configuredIndex >= 0 ? steps[configuredIndex] : (s.stepId ? undefined : steps[s.stepIndex]);
    const isConsent = s.stepId === '__consent__';
    const med = median(s.durations);
    return {
      key,
      stepIndex: s.stepIndex,
      stepId: s.stepId,
      label: stepLabel(step, s.stepId, s.stepIndex),
      removed: !step && !isConsent,
      sessions: s.reached,
      reachRate: pct(s.reached, entered),
      dropped: s.dropped,
      dropRate: pct(s.dropped, s.reached),
      medianSeconds: med === null ? null : Math.round(med * 10) / 10,
      // Order by the configured position; the consent step always comes last,
      // and removed steps sort by where they used to be.
      order: isConsent ? steps.length + 1 : configuredIndex >= 0 ? configuredIndex : s.stepIndex,
    };
  }).sort((a, b) => a.order - b.order || a.stepIndex - b.stepIndex);
}

function dailyTrend(db, formId, range) {
  return db.prepare(`
    SELECT date(created_at) as day, event, COUNT(DISTINCT session_id) as sessions
    FROM analytics_events
    WHERE form_id = ? AND ${rangeSql(range)} AND event IN ('view', 'start', 'complete')
    GROUP BY day, event
    ORDER BY day
  `).all(formId, ...rangeArgs(range));
}

function periodReport(db, form, steps, range) {
  const step = stepStats(db, form.id, range);
  return {
    range: { from: range.from, to: range.to, days: range.days },
    summary: { ...summarize(eventCounts(db, [form.id], range)), entered: step.entered },
    stepDropoff: stepRows(steps, step),
  };
}

// Get analytics overview for all forms, with the same-length period right
// before it for a trend.
router.get('/overview', (req, res) => {
  const db = getDb();
  const forms = db.prepare('SELECT id, title, slug, published FROM forms WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  if (forms.length === 0) return res.json({ forms: [] });

  const range = resolveRange(undefined, undefined, req.query.days);
  const previous = {
    since: sinceSql(range.days * 2),
    until: range.since,
  };
  const formIds = forms.map(f => f.id);
  const current = eventCounts(db, formIds, range);
  const before = eventCounts(db, formIds, previous);

  res.json({
    days: range.days,
    forms: forms.map(form => ({
      ...form,
      published: !!form.published,
      ...summarize(current.filter(s => s.form_id === form.id)),
      previous: summarize(before.filter(s => s.form_id === form.id)),
    })),
  });
});

// Detailed analytics for one form: ?from=&to= (UTC days, inclusive) or
// ?days=N, plus an optional ?compareFrom=&compareTo= period to diff against.
router.get('/:formId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT * FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const range = resolveRange(req.query.from, req.query.to, req.query.days);
  if (range.error) return res.status(400).json({ error: range.error });
  let compareRange = null;
  if (req.query.compareFrom !== undefined || req.query.compareTo !== undefined) {
    compareRange = resolveRange(req.query.compareFrom, req.query.compareTo);
    if (compareRange.error) return res.status(400).json({ error: `Comparison: ${compareRange.error}` });
  }

  let steps;
  try { steps = JSON.parse(form.steps); } catch { steps = []; }
  if (!Array.isArray(steps)) steps = [];

  const current = periodReport(db, form, steps, range);
  res.json({
    formId: form.id,
    title: form.title,
    slug: form.slug,
    days: range.days,
    ...current,
    daily: dailyTrend(db, form.id, range),
    compare: compareRange ? periodReport(db, form, steps, compareRange) : null,
  });
});

module.exports = router;
