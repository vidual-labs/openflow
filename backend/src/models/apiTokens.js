const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { getDb } = require('./db');

// ──────────────────────────────────────────
// API tokens
//
// Long-lived, read-only API tokens for programmatic API access (e.g. the
// lodgely lead-intake connector pulling submissions). Unlike the JWT login
// flow, a token can be revoked individually without changing the account
// password, and it is read-only — the auth middleware rejects any non-GET
// request authenticated by a token.
//
// The plaintext token is shown to the user exactly once, at creation. Only a
// SHA-256 hash is stored, so a database leak does not expose usable tokens.
// ──────────────────────────────────────────

const TOKEN_PREFIX = 'ofw_';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Generate a fresh opaque token string: `ofw_` + 40 hex chars. */
function generateToken() {
  return TOKEN_PREFIX + crypto.randomBytes(20).toString('hex');
}

/** True if a string looks like one of our API tokens (cheap pre-check). */
function looksLikeApiToken(value) {
  return typeof value === 'string' && value.startsWith(TOKEN_PREFIX);
}

/**
 * Create a token for a user. Returns the row metadata plus the one-time
 * plaintext `token` — persist nothing but the hash.
 */
function createToken(userId, name) {
  const db = getDb();
  const token = generateToken();
  const id = uuid();
  // A recognisable, non-secret prefix so the UI can label which token is which.
  const prefix = token.slice(0, TOKEN_PREFIX.length + 8);

  db.prepare(
    'INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, name, hashToken(token), prefix);

  const row = db.prepare(
    'SELECT id, name, token_prefix, last_used_at, created_at FROM api_tokens WHERE id = ?'
  ).get(id);

  return { ...row, token };
}

/** List a user's tokens (metadata only — never the hash or plaintext). */
function listTokens(userId) {
  return getDb().prepare(
    'SELECT id, name, token_prefix, last_used_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

/** Resolve a plaintext token to its row, or undefined if unknown. */
function findByToken(token) {
  return getDb().prepare(
    'SELECT id, user_id, name FROM api_tokens WHERE token_hash = ?'
  ).get(hashToken(token));
}

/** Stamp last_used_at so operators can spot stale or rogue tokens. */
function touchLastUsed(id) {
  getDb().prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(id);
}

/** Revoke one of a user's tokens. Returns true if a row was deleted. */
function revokeToken(userId, id) {
  const result = getDb().prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

module.exports = {
  TOKEN_PREFIX,
  looksLikeApiToken,
  createToken,
  listTokens,
  findByToken,
  touchLastUsed,
  revokeToken,
};
