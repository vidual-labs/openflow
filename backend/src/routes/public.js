const { Router } = require('express');
const { getDb } = require('../models/db');
const { checkRateLimit } = require('../models/rateLimit');
const { v4: uuid } = require('uuid');

const router = Router();

// Get published form by slug (public)
router.get('/form/:slug', (req, res) => {
  const db = getDb();
  const form = db.prepare(
    'SELECT id, title, slug, steps, end_screen, theme, gtm_id FROM forms WHERE slug = ? AND published = 1'
  ).get(req.params.slug);

  if (!form) return res.status(404).json({ error: 'Form not found' });

  form.steps = JSON.parse(form.steps);
  form.end_screen = JSON.parse(form.end_screen);
  form.theme = JSON.parse(form.theme);
  res.json({ form });
});

// Submit form response (public)
router.post('/form/:slug/submit', async (req, res) => {
  // Rate limit: 10 submissions per IP per minute
  const ip = req.ip || req.connection.remoteAddress;
  const allowed = checkRateLimit(`submit:${ip}`, 10, 60);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many submissions, please try again later' });
  }

  const db = getDb();
  const form = db.prepare('SELECT id, title, steps FROM forms WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const steps = JSON.parse(form.steps);
  const { data } = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid submission data' });
  }

  // Basic validation
  for (const step of steps) {
    if (step.required && (!data[step.id] || String(data[step.id]).trim() === '')) {
      return res.status(400).json({ error: `Field "${step.label || step.id}" is required` });
    }
  }

  const id = uuid();
  const metadata = {
    ip,
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer || '',
    submittedAt: new Date().toISOString(),
  };

  db.prepare('INSERT INTO submissions (id, form_id, data, metadata) VALUES (?, ?, ?, ?)').run(
    id, form.id, JSON.stringify(data), JSON.stringify(metadata)
  );

  res.status(201).json({ ok: true, id });

  // Run integrations async (don't block response)
  const { runIntegrations } = require('../models/integrations');
  runIntegrations(db, form.id, form.title, data, steps).catch(err => {
    console.error('Integration execution error:', err.message);
  });
});

// Track analytics event (public, rate limited)
router.post('/track', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const allowed = checkRateLimit(`track:${ip}`, 100, 60);
  if (!allowed) return res.status(429).json({ error: 'Rate limited' });

  const { formId, event, sessionId, stepIndex, stepId } = req.body;
  if (!formId || !event) return res.status(400).json({ error: 'Missing formId or event' });

  const validEvents = ['view', 'start', 'step', 'complete', 'drop'];
  if (!validEvents.includes(event)) return res.status(400).json({ error: 'Invalid event type' });

  const db = getDb();
  try {
    db.prepare(
      'INSERT INTO analytics_events (form_id, event, session_id, step_index, step_id) VALUES (?, ?, ?, ?, ?)'
    ).run(formId, event, sessionId || null, stepIndex ?? null, stepId || null);
  } catch {}

  res.json({ ok: true });
});

module.exports = router;
