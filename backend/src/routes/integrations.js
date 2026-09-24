const { Router } = require('express');
const { getDb } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const { encrypt, decrypt } = require('../models/encryption');
const { redactConfig, mergeConfig } = require('../models/integrationSecrets');
const { randomUUID: uuid } = require('crypto');

const router = Router();
router.use(authMiddleware);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// null when the stored config can't be decrypted (e.g. ENCRYPTION_KEY was
// changed or lost) — distinct from an empty config, so it is never silently
// overwritten.
function readConfig(row) {
  try { return JSON.parse(decrypt(row.config)); } catch { return null; }
}

const UNREADABLE_CONFIG = 'This integration\'s settings could not be decrypted. Check that ENCRYPTION_KEY (or data/.encryption_key) is the key they were saved with.';

// Never send stored secrets back to the client — see models/integrationSecrets.js.
function toResponse(row) {
  const stored = readConfig(row);
  const { config, secrets } = redactConfig(row.type, stored || {});
  return stored ? { ...row, config, secrets } : { ...row, config, secrets, config_error: UNREADABLE_CONFIG };
}

// List integrations for a form
router.get('/:formId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const integrations = db.prepare('SELECT * FROM integrations WHERE form_id = ? ORDER BY created_at DESC').all(req.params.formId);
  res.json({ integrations: integrations.map(toResponse) });
});

// Create integration
router.post('/:formId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const { type, config, enabled } = req.body;
  if (config !== undefined && !isPlainObject(config)) {
    return res.status(400).json({ error: 'config must be an object' });
  }
  if (!type || !['webhook', 'email', 'google_sheets', 'google_ads_conversion', 'meta_conversion_api'].includes(type)) {
    return res.status(400).json({ error: 'Invalid integration type. Use: webhook, email, google_sheets, google_ads_conversion, meta_conversion_api' });
  }

  const id = uuid();
  db.prepare('INSERT INTO integrations (id, form_id, type, enabled, config) VALUES (?, ?, ?, ?, ?)').run(
    id, req.params.formId, type, enabled !== undefined ? (enabled ? 1 : 0) : 1, encrypt(JSON.stringify(config || {}))
  );

  const integration = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  res.status(201).json({ integration: toResponse(integration) });
});

// Update integration
router.put('/:formId/:integrationId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const existing = db.prepare('SELECT * FROM integrations WHERE id = ? AND form_id = ?').get(req.params.integrationId, req.params.formId);
  if (!existing) return res.status(404).json({ error: 'Integration not found' });

  const { config, enabled } = req.body;
  if (config !== undefined && config !== null && !isPlainObject(config)) {
    return res.status(400).json({ error: 'config must be an object' });
  }

  const stored = config ? readConfig(existing) : null;
  if (config && !stored) {
    // Saving would replace the unreadable (but maybe recoverable with the
    // right key) config and drop its secrets.
    return res.status(409).json({ error: UNREADABLE_CONFIG });
  }

  db.prepare('UPDATE integrations SET config = COALESCE(?, config), enabled = COALESCE(?, enabled) WHERE id = ?').run(
    config ? encrypt(JSON.stringify(mergeConfig(existing.type, stored, config))) : null,
    enabled !== undefined ? (enabled ? 1 : 0) : null,
    req.params.integrationId
  );

  const updated = db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.integrationId);
  res.json({ integration: toResponse(updated) });
});

// Delete integration
router.delete('/:formId/:integrationId', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  // integration_deliveries rows reference this integration via a foreign key
  // (foreign_keys = ON), so an integration that has ever attempted a
  // delivery must have its delivery history cleared first or the DELETE
  // below throws a FOREIGN KEY constraint error.
  const deleteIntegration = db.transaction(() => {
    db.prepare('DELETE FROM integration_deliveries WHERE integration_id = ?').run(req.params.integrationId);
    db.prepare('DELETE FROM integrations WHERE id = ? AND form_id = ?').run(req.params.integrationId, req.params.formId);
  });
  deleteIntegration();
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

  const { runIntegrations, testGoogleAdsCredentials, testMetaConversionApiCredentials } = require('../models/integrations');

  // A synthetic test submission has no real gclid, so actually running this
  // integration would either fail outright or upload a fake conversion to a
  // real Google Ads account. Instead, just verify the OAuth credentials work.
  if (integration.type === 'google_ads_conversion') {
    try {
      await testGoogleAdsCredentials(JSON.parse(decrypt(integration.config)));
      return res.json({ results: [{ id: integration.id, type: integration.type, ok: true }] });
    } catch (err) {
      return res.json({ results: [{ id: integration.id, type: integration.type, ok: false, error: err.message }] });
    }
  }

  // Same concern as Google Ads above: a synthetic test submission would post
  // a fake (but real) Lead event to the advertiser's Meta account. Only run
  // it for real when a test_event_code is configured — Meta then routes the
  // event to the Test Events tool instead of counting it as a real lead.
  if (integration.type === 'meta_conversion_api') {
    const config = JSON.parse(decrypt(integration.config));
    if (!config.test_event_code) {
      try {
        await testMetaConversionApiCredentials(config);
        return res.json({ results: [{ id: integration.id, type: integration.type, ok: true }] });
      } catch (err) {
        return res.json({ results: [{ id: integration.id, type: integration.type, ok: false, error: err.message }] });
      }
    }
  }

  try {
    // Run just this one integration
    const config = JSON.parse(decrypt(integration.config));
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

// List delivery attempts for a form's integrations, most recent first. Lets
// the dashboard surface failed/dead leads instead of them vanishing silently.
router.get('/:formId/deliveries', (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const deliveries = db.prepare(
    `SELECT id, integration_id, submission_id, type, status, attempts, last_error, next_attempt_at, created_at, updated_at
     FROM integration_deliveries WHERE form_id = ? ORDER BY created_at DESC LIMIT 100`
  ).all(req.params.formId);
  res.json({ deliveries });
});

// Manually retry a failed/dead delivery (e.g. after the client fixes their
// endpoint).
router.post('/:formId/deliveries/:deliveryId/retry', async (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT id FROM forms WHERE id = ? AND user_id = ?').get(req.params.formId, req.userId);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const existing = db.prepare('SELECT id FROM integration_deliveries WHERE id = ? AND form_id = ?').get(req.params.deliveryId, req.params.formId);
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });

  const { retryDelivery } = require('../models/deliveryQueue');
  try {
    const delivery = await retryDelivery(db, req.params.deliveryId);
    res.json({ delivery });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
