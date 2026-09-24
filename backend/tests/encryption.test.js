const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const { encrypt, decrypt, isEncrypted } = require('../src/models/encryption');

function getDb() {
  return require('../src/models/db').getDb();
}

function seedUser() {
  const db = getDb();
  const userId = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, 'owner@test.com', bcrypt.hashSync('ownerpass', 10), 'admin');
  return userId;
}

async function login(app) {
  const res = await request(app).post('/api/auth/login').send({ email: 'owner@test.com', password: 'ownerpass' });
  return res.headers['set-cookie'];
}

describe('encryption module', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const secret = JSON.stringify({ smtp_pass: 'hunter2', url: 'https://example.com/hook' });
    const ciphertext = encrypt(secret);
    expect(isEncrypted(ciphertext)).toBe(true);
    expect(ciphertext).not.toContain('hunter2');
    expect(decrypt(ciphertext)).toBe(secret);
  });

  it('passes pre-migration plaintext rows through unchanged', () => {
    const plaintext = JSON.stringify({ url: 'https://example.com/hook' });
    expect(isEncrypted(plaintext)).toBe(false);
    expect(decrypt(plaintext)).toBe(plaintext);
  });
});

describe('integration config at rest', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('stores integration config encrypted in the database, not as plaintext JSON', async () => {
    const userId = seedUser();
    const db = getDb();
    const formId = uuid();
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps) VALUES (?, ?, ?, ?, ?)')
      .run(formId, userId, 'Encrypted Config', 'encrypted-config', '[]');

    const cookie = await login(app);
    const res = await request(app)
      .post(`/api/integrations/${formId}`)
      .set('Cookie', cookie)
      .send({ type: 'webhook', config: { url: 'https://example.com/hook', secret: 'top-secret-value' } });

    expect(res.status).toBe(201);
    // Secrets are write-only: the response only says the secret is set.
    expect(res.body.integration.config).not.toHaveProperty('secret');
    expect(res.body.integration.secrets.secret).toEqual({ set: true });

    // The raw DB row must not contain the plaintext secret.
    const row = db.prepare('SELECT config FROM integrations WHERE id = ?').get(res.body.integration.id);
    expect(isEncrypted(row.config)).toBe(true);
    expect(row.config).not.toContain('top-secret-value');
  });
});

describe('encryption key rotation from the auto-generated key file', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');

  function loadWith(env) {
    let mod;
    const saved = { DB_PATH: process.env.DB_PATH, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY };
    Object.assign(process.env, env);
    if (!env.ENCRYPTION_KEY) delete process.env.ENCRYPTION_KEY;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      jest.isolateModules(() => { mod = require('../src/models/encryption'); });
    } finally {
      process.env.DB_PATH = saved.DB_PATH;
      if (saved.ENCRYPTION_KEY === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = saved.ENCRYPTION_KEY;
      console.warn.mockRestore();
    }
    return mod;
  }

  it('still decrypts values written with the old key file after ENCRYPTION_KEY is set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofw-key-'));
    const DB_PATH = path.join(dir, 'openflow.db');

    const before = loadWith({ DB_PATH });
    const stored = before.encrypt('hunter2');
    expect(fs.existsSync(path.join(dir, '.encryption_key'))).toBe(true);

    const after = loadWith({ DB_PATH, ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') });
    expect(after.decrypt(stored)).toBe('hunter2');
    // New writes use ENCRYPTION_KEY, which the old key file can't read.
    expect(() => before.decrypt(after.encrypt('x'))).toThrow();
  });

  it('refuses to start on a corrupt key file instead of replacing it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofw-key-'));
    fs.writeFileSync(path.join(dir, '.encryption_key'), 'not-hex');
    expect(() => loadWith({ DB_PATH: path.join(dir, 'openflow.db') })).toThrow(/not a valid/);
    expect(fs.readFileSync(path.join(dir, '.encryption_key'), 'utf8')).toBe('not-hex');
  });
});
