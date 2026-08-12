const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Encrypts integration secrets (SMTP passwords, Google service-account keys,
// OAuth refresh tokens, webhook HMAC secrets) before they're stored in the
// integrations.config column, so a stolen/leaked SQLite file or backup JSON
// doesn't hand over every credential in plaintext.
//
// Key handling mirrors middleware/auth.js's JWT_SECRET: if ENCRYPTION_KEY
// isn't set, generate a random 32-byte key and persist it next to the DB so
// it survives restarts, rather than ever using a hardcoded/guessable key.
// Unlike JWT_SECRET, losing this key makes existing encrypted config
// unrecoverable (there's no "everyone just logs in again" fallback) — back
// it up separately from the DB in production.
function loadOrCreateKey() {
  if (process.env.ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return key;
  }

  const dataDir = path.dirname(process.env.DB_PATH || path.join(__dirname, '../../data/openflow.db'));
  const keyPath = path.join(dataDir, '.encryption_key');

  try {
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath, 'utf8').trim();
      if (existing) return Buffer.from(existing, 'hex');
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, generated.toString('hex'), { mode: 0o600 });
    console.warn(
      'WARNING: ENCRYPTION_KEY is not set. Generated and persisted a random key at ' + keyPath +
      '. Set ENCRYPTION_KEY explicitly in production and back it up separately from the database.'
    );
    return generated;
  } catch (err) {
    console.warn(
      'WARNING: ENCRYPTION_KEY is not set and could not be persisted (' + err.message +
      '). Using an ephemeral key; encrypted integration secrets will become unreadable after this process exits.'
    );
    return crypto.randomBytes(32);
  }
}

const KEY = loadOrCreateKey();
const PREFIX = 'enc:v1:';

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

// Transparently passes through plaintext (pre-migration rows written before
// this feature existed), so old integrations keep working until they're next
// saved, at which point routes/integrations.js re-encrypts them.
function decrypt(stored) {
  if (!isEncrypted(stored)) return stored;

  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted };
