const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const router = Router();
router.use(authMiddleware);

// List integrations for a form
router.get('/:formId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const integrations = db.prepare('SELECT * FROM integrations WHERE form_id = ? ORDER BY created_at DESC').all(req.params.formId);
  integrations.forEach(i => { i.config = JSON.parse(i.config); });
  res.json({ integrations });
});

// Create integration
router.post('/:formId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const { type, config, enabled } = req.body;
  if (!type || !['webhook', 'email', 'google_sheets'].includes(type)) {
    return res.status(400).json({ error: 'Invalid integration type. Use: webhook, email, google_sheets' });
  }

  const id = uuid();
  db.prepare('INSERT INTO integrations (id, form_id, type, enabled, config) VALUES (?, ?, ?, ?, ?)').run(
    id, req.params.formId, type, enabled !== undefined ? (enabled ? 1 : 0) : 1, JSON.stringify(config || {})
  );

  const integration = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  integration.config = JSON.parse(integration.config);
  res.status(201).json({ integration });
});

// Update integration
router.put('/:formId/:integrationId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const existing = db.prepare('SELECT * FROM integrations WHERE id = ? AND form_id = ?').get(req.params.integrationId, req.params.formId);
  if (!existing) return res.status(404).json({ error: 'Integration not found' });

  const { config, enabled } = req.body;

  db.prepare('UPDATE integrations SET config = COALESCE(?, config), enabled = COALESCE(?, enabled) WHERE id = ?').run(
    config ? JSON.stringify(config) : null,
    enabled !== undefined ? (enabled ? 1 : 0) : null,
    req.params.integrationId
  );

  const updated = db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.integrationId);
  updated.config = JSON.parse(updated.config);
  res.json({ integration: updated });
});

// Delete integration
router.delete('/:formId/:integrationId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  db.prepare('DELETE FROM integrations WHERE id = ? AND form_id = ?').run(req.params.integrationId, req.params.formId);
  res.json({ ok: true });
});

// Test integration
router.post('/:formId/:integrationId/test', async (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT * FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const integration = db.prepare('SELECT * FROM integrations WHERE id = ? AND form_id = ?').get(req.params.integrationId, req.params.formId);
  if (!integration) return res.status(404).json({ error: 'Integration not found' });

  const steps = JSON.parse(form.steps);
  const testData = {};
  steps.forEach(s => { testData[s.id] = `Test value for ${s.label || s.id}`; });

  const { runIntegrations } = require('../models/integrations');

  try {
    // Run just this one integration
    const config = JSON.parse(integration.config);
    const singleDb = {
      prepare: () => ({
        all: () => [{ ...integration, config: JSON.stringify(config) }],
      }),
    };
    const results = await runIntegrations(singleDb, form.id, form.title, testData, steps);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
