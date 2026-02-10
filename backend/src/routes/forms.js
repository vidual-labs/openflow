const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { customAlphabet } = require('nanoid');

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);
const router = Router();

router.use(authMiddleware);

// List forms
router.get('/', (req, res) => {
  const db = getDb();
  const forms = db.prepare(`
    SELECT id, title, slug, published, created_at, updated_at,
      (SELECT COUNT(*) FROM submissions WHERE form_id = forms.id) as submission_count
    FROM forms WHERE user_id = ? ORDER BY updated_at DESC
  `).all(req.userId);
  res.json({ forms });
});

// Get single form
router.get('/:id', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT * FROM forms WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  form.steps = JSON.parse(form.steps);
  form.end_screen = JSON.parse(form.end_screen);
  form.theme = JSON.parse(form.theme);
  res.json({ form });
});

// Create form
router.post('/', (req, res) => {
  const db = getDb();
  const id = uuid();
  const slug = nanoid();
  const { title, steps, end_screen, theme, gtm_id } = req.body;

  db.prepare(`
    INSERT INTO forms (id, user_id, title, slug, steps, end_screen, theme, gtm_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.userId,
    title || 'Untitled Form',
    slug,
    JSON.stringify(steps || []),
    JSON.stringify(end_screen || { title: 'Danke!', message: 'Wir melden uns bei Ihnen.' }),
    JSON.stringify(theme || {}),
    gtm_id || ''
  );

  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(id);
  form.steps = JSON.parse(form.steps);
  form.end_screen = JSON.parse(form.end_screen);
  form.theme = JSON.parse(form.theme);
  res.status(201).json({ form });
});

// Update form
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM forms WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Form not found' });

  const { title, steps, end_screen, theme, gtm_id, published } = req.body;

  db.prepare(`
    UPDATE forms SET
      title = COALESCE(?, title),
      steps = COALESCE(?, steps),
      end_screen = COALESCE(?, end_screen),
      theme = COALESCE(?, theme),
      gtm_id = COALESCE(?, gtm_id),
      published = COALESCE(?, published),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title ?? null,
    steps ? JSON.stringify(steps) : null,
    end_screen ? JSON.stringify(end_screen) : null,
    theme ? JSON.stringify(theme) : null,
    gtm_id ?? null,
    published ?? null,
    req.params.id
  );

  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
  form.steps = JSON.parse(form.steps);
  form.end_screen = JSON.parse(form.end_screen);
  form.theme = JSON.parse(form.theme);
  res.json({ form });
});

// Delete form
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Form not found' });
  db.prepare('DELETE FROM submissions WHERE form_id = ?').run(req.params.id);
  db.prepare('DELETE FROM forms WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
