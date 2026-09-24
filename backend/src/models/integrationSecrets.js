// Integration secrets are write-only over the API: they are stored encrypted
// (models/encryption.js) and used server-side when an integration runs, but
// no API response ever returns them. Otherwise anyone holding a read-only API
// token (or a hijacked session) could read every SMTP password, service
// account private key and OAuth refresh token by simply GETting
// /api/integrations/:formId — the encryption at rest would protect the DB
// file but not the credentials themselves.
//
// Clients see, per secret field, only whether it is set (plus a harmless hint
// where one helps, e.g. which service-account email to share a sheet with).
// On update, a secret field that is omitted keeps its stored value; `null` or
// '' clears it; any other value replaces it.
const SECRET_FIELDS = {
  webhook: ['secret'],
  email: ['smtp_pass'],
  google_sheets: ['credentials_json'],
  google_ads_conversion: ['client_secret', 'refresh_token'],
  meta_conversion_api: ['access_token'],
};

function secretFields(type) {
  return SECRET_FIELDS[type] || [];
}

function isSet(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function secretHint(field, value) {
  if (field !== 'credentials_json') return undefined;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return typeof parsed?.client_email === 'string' ? parsed.client_email : undefined;
  } catch {
    return undefined;
  }
}

// Returns { config, secrets }: the config without any secret values, and a
// `{ [field]: { set, hint? } }` map describing them.
function redactConfig(type, config) {
  const redacted = { ...(config || {}) };
  const secrets = {};
  for (const field of secretFields(type)) {
    const value = redacted[field];
    delete redacted[field];
    const info = { set: isSet(value) };
    const hint = info.set ? secretHint(field, value) : undefined;
    if (hint) info.hint = hint;
    secrets[field] = info;
  }
  return { config: redacted, secrets };
}

// Merges an incoming (client-supplied) config over the stored one, keeping
// stored secrets the client didn't send.
function mergeConfig(type, stored, incoming) {
  const merged = { ...incoming };
  for (const field of secretFields(type)) {
    if (!(field in incoming) || incoming[field] === undefined) {
      if (stored && field in stored) merged[field] = stored[field];
    } else if (incoming[field] === null || incoming[field] === '') {
      delete merged[field];
    }
  }
  return merged;
}

module.exports = { SECRET_FIELDS, redactConfig, mergeConfig };
