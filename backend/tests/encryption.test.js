const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
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
    // The API response decrypts for the caller.
    expect(res.body.integration.config.secret).toBe('top-secret-value');

    // The raw DB row must not contain the plaintext secret.
    const row = db.prepare('SELECT config FROM integrations WHERE id = ?').get(res.body.integration.id);
    expect(isEncrypted(row.config)).toBe(true);
    expect(row.config).not.toContain('top-secret-value');
  });
});
