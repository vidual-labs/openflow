const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

router.use(authMiddleware);

// List submissions for a form
router.get('/:formId', (req, res) => {
  const db = getDb();
  // Verify ownership
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as count FROM submissions WHERE form_id = ?').get(req.params.formId).count;
  const submissions = db.prepare(
    'SELECT * FROM submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(req.params.formId, limit, offset);

  submissions.forEach(s => {
    s.data = JSON.parse(s.data);
    s.metadata = JSON.parse(s.metadata);
  });

  res.json({ submissions, total, page, limit });
});

// Export submissions as CSV
router.get('/:formId/export', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT * FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const submissions = db.prepare(
    'SELECT * FROM submissions WHERE form_id = ? ORDER BY created_at DESC'
  ).all(req.params.formId);

  const steps = JSON.parse(form.steps);
  const headers = ['Submitted At', ...steps.map(s => s.label || s.question || s.id)];
  const rows = submissions.map(s => {
    const data = JSON.parse(s.data);
    return [s.created_at, ...steps.map(step => data[step.id] ?? '')];
  });

  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${form.slug}-submissions.csv"`);
  res.send(csv);
});

// Delete a submission
router.delete('/:formId/:submissionId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  db.prepare('DELETE FROM submissions WHERE id = ? AND form_id = ?').run(req.params.submissionId, req.params.formId);
  res.json({ ok: true });
});

module.exports = router;
