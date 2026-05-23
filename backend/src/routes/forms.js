const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { customAlphabet } = require('nanoid');
const { validateSlug } = require('../utils/slug');
const { validateSubdomain } = require('../utils/subdomain');

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
  try {
    form.steps = JSON.parse(form.steps);
    form.end_screen = JSON.parse(form.end_screen);
    form.theme = JSON.parse(form.theme);
  } catch {
    return res.status(500).json({ error: 'Form data is corrupted' });
  }
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
    JSON.stringify(end_screen || { title: 'Thank you!', message: 'We will get back to you shortly.' }),
    JSON.stringify(theme || {}),
    gtm_id || ''
  );

  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(id);
  try {
    form.steps = JSON.parse(form.steps);
    form.end_screen = JSON.parse(form.end_screen);
    form.theme = JSON.parse(form.theme);
  } catch {
    return res.status(500).json({ error: 'Failed to read created form' });
  }
  res.status(201).json({ form });
});

// Update form
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM forms WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Form not found' });

  const { title, slug, subdomain, steps, end_screen, theme, gtm_id, published } = req.body;

  // Handle subdomain change separately: validate, check uniqueness.
  // null/empty string clears it.
  if (subdomain !== undefined) {
    const normalised = subdomain === null || subdomain === '' ? null : String(subdomain).trim().toLowerCase();
    if (normalised !== (existing.subdomain || null)) {
      if (normalised !== null) {
        const v = validateSubdomain(normalised);
        if (!v.ok) return res.status(400).json({ error: v.error });
        const taken = db.prepare(
          'SELECT id FROM forms WHERE subdomain = ? AND id != ?'
        ).get(normalised, req.params.id);
        if (taken) return res.status(409).json({ error: 'That subdomain is already in use by another form' });
      }
      try {
        db.prepare('UPDATE forms SET subdomain = ?, updated_at = datetime(\'now\') WHERE id = ?').run(normalised, req.params.id);
      } catch (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ error: 'That subdomain is already in use' });
        }
        throw err;
      }
    }
  }

  // Handle slug change separately: validate, check uniqueness, archive old slug.
  if (slug !== undefined && slug !== existing.slug) {
    const v = validateSlug(slug);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const slugTaken = db.prepare(
      'SELECT id FROM forms WHERE slug = ? AND id != ?'
    ).get(slug, req.params.id);
    if (slugTaken) return res.status(409).json({ error: 'That URL is already in use by another form' });

    const historyTaken = db.prepare(
      'SELECT form_id FROM slug_history WHERE old_slug = ? AND form_id != ?'
    ).get(slug, req.params.id);
    if (historyTaken) return res.status(409).json({ error: 'That URL was previously used by another form and cannot be reused' });

    const updateSlug = db.transaction(() => {
      // Record the current slug as historical (skip if already an alias of this form).
      db.prepare(
        'INSERT OR IGNORE INTO slug_history (old_slug, form_id) VALUES (?, ?)'
      ).run(existing.slug, req.params.id);
      // If the new slug was previously an alias of THIS form, remove it from history so it's free as canonical.
      db.prepare('DELETE FROM slug_history WHERE old_slug = ?').run(slug);
      db.prepare('UPDATE forms SET slug = ?, updated_at = datetime(\'now\') WHERE id = ?').run(slug, req.params.id);
    });
    try {
      updateSlug();
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'That URL is already in use' });
      }
      throw err;
    }
  }

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
  try {
    form.steps = JSON.parse(form.steps);
    form.end_screen = JSON.parse(form.end_screen);
    form.theme = JSON.parse(form.theme);
  } catch {
    return res.status(500).json({ error: 'Form data is corrupted' });
  }
  res.json({ form });
});

// Delete form
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Form not found' });
  const deleteForm = db.transaction((formId) => {
    db.prepare('DELETE FROM analytics_events WHERE form_id = ?').run(formId);
    db.prepare('DELETE FROM integrations WHERE form_id = ?').run(formId);
    db.prepare('DELETE FROM submissions WHERE form_id = ?').run(formId);
    db.prepare('DELETE FROM forms WHERE id = ?').run(formId);
  });
  deleteForm(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
