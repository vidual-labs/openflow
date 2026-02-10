const { Router } = require('express');
const { getDb } = require('../models/db');
const { checkRateLimit } = require('../models/redis');
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
  const allowed = await checkRateLimit(`submit:${ip}`, 10, 60);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many submissions, please try again later' });
  }

  const db = getDb();
  const form = db.prepare('SELECT id, steps FROM forms WHERE slug = ? AND published = 1').get(req.params.slug);
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
});

module.exports = router;
