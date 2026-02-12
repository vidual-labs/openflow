const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// Get analytics overview for all forms
router.get('/overview', (req, res) => {
  const db = getDb();
  const forms = db.prepare('SELECT id, title, slug FROM forms WHERE user_id = ?').all(req.userId);
  const formIds = forms.map(f => f.id);

  if (formIds.length === 0) return res.json({ forms: [] });

  const placeholders = formIds.map(() => '?').join(',');
  const days = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const stats = db.prepare(`
    SELECT form_id, event, COUNT(*) as count,
           COUNT(DISTINCT session_id) as unique_sessions
    FROM analytics_events
    WHERE form_id IN (${placeholders}) AND created_at >= ?
    GROUP BY form_id, event
  `).all(...formIds, since);

  const result = forms.map(form => {
    const formStats = stats.filter(s => s.form_id === form.id);
    const views = formStats.find(s => s.event === 'view')?.unique_sessions || 0;
    const starts = formStats.find(s => s.event === 'start')?.unique_sessions || 0;
    const completions = formStats.find(s => s.event === 'complete')?.unique_sessions || 0;
    return {
      ...form,
      views,
      starts,
      completions,
      conversionRate: views > 0 ? Math.round((completions / views) * 100) : 0,
    };
  });

  res.json({ forms: result });
});

// Get detailed analytics for a specific form
router.get('/:formId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT * FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const days = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Overall funnel
  const funnel = db.prepare(`
    SELECT event, COUNT(*) as total, COUNT(DISTINCT session_id) as unique_sessions
    FROM analytics_events
    WHERE form_id = ? AND created_at >= ?
    GROUP BY event
  `).all(req.params.formId, since);

  // Step drop-off
  const stepEvents = db.prepare(`
    SELECT step_index, step_id, COUNT(DISTINCT session_id) as sessions
    FROM analytics_events
    WHERE form_id = ? AND event = 'step' AND created_at >= ? AND step_index IS NOT NULL
    GROUP BY step_index
    ORDER BY step_index
  `).all(req.params.formId, since);

  // Daily trend
  const daily = db.prepare(`
    SELECT date(created_at) as day, event, COUNT(DISTINCT session_id) as sessions
    FROM analytics_events
    WHERE form_id = ? AND created_at >= ? AND event IN ('view', 'start', 'complete')
    GROUP BY day, event
    ORDER BY day
  `).all(req.params.formId, since);

  const steps = JSON.parse(form.steps);

  const views = funnel.find(f => f.event === 'view')?.unique_sessions || 0;
  const starts = funnel.find(f => f.event === 'start')?.unique_sessions || 0;
  const completions = funnel.find(f => f.event === 'complete')?.unique_sessions || 0;

  res.json({
    formId: form.id,
    title: form.title,
    days,
    summary: {
      views,
      starts,
      completions,
      conversionRate: views > 0 ? Math.round((completions / views) * 100) : 0,
      startRate: views > 0 ? Math.round((starts / views) * 100) : 0,
    },
    stepDropoff: stepEvents.map(se => ({
      stepIndex: se.step_index,
      stepId: se.step_id,
      label: steps[se.step_index]?.label || steps[se.step_index]?.question || `Step ${se.step_index + 1}`,
      sessions: se.sessions,
    })),
    daily,
  });
});

module.exports = router;
