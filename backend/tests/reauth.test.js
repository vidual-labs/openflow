const request = require('supertest');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const apiTokens = require('../src/models/apiTokens');
const sessions = require('../src/models/sessions');
const { REAUTH_WINDOW_MS } = require('../src/middleware/auth');

// "Sudo mode": backup/restore, user management and minting API tokens need
// the password re-entered on this very session within the last 10 minutes
// (POST /api/auth/confirm-password), so a script that rides along with a
// signed-in browser can't do them with the session cookie alone.

function getDb() {
  return require('../src/models/db').getDb();
}

const PASSWORD = 'correct-horse-battery';

function createUser(email, { role = 'user', twofa = false } = {}) {
  const id = uuid();
  getDb().prepare('INSERT INTO users (id, email, password_hash, role, twofa_enabled) VALUES (?, ?, ?, ?, ?)')
    .run(id, email, bcrypt.hashSync(PASSWORD, 10), role, twofa ? 1 : 0);
  return id;
}

function sessionIdOf(cookie) {
  const raw = cookie.slice('token='.length);
  return getDb().prepare('SELECT id FROM sessions WHERE token_hash = ?').get(sessions.hashToken(raw)).id;
}

function setReauthAt(cookie, at) {
  getDb().prepare('UPDATE sessions SET reauth_at = ? WHERE id = ?').run(at, sessionIdOf(cookie));
}

function auditActions() {
  return getDb().prepare('SELECT action FROM audit_log ORDER BY id').all().map(r => r.action);
}

describe('Sudo mode (re-confirm the password)', () => {
  let app;
  let backupDir;

  beforeAll(() => {
    app = createTestApp();
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-reauth-'));
    process.env.BACKUP_DIR = backupDir;
  });

  afterAll(() => {
    delete process.env.BACKUP_DIR;
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  async function login(email) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'].find(c => c.startsWith('token=')).split(';')[0];
  }

  function confirm(cookie, password = PASSWORD) {
    return request(app).post('/api/auth/confirm-password').set('Cookie', cookie).send({ password });
  }

  it('uses a single 10-minute window', () => {
    expect(REAUTH_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  describe('POST /api/auth/confirm-password', () => {
    it('marks only the current session as recently confirmed', async () => {
      const userId = createUser('admin@test.com', { role: 'admin' });
      const here = await login('admin@test.com');
      const elsewhere = await login('admin@test.com');

      const before = Date.now();
      const res = await confirm(here);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.validUntil).toBeGreaterThanOrEqual(before + REAUTH_WINDOW_MS);

      const rows = getDb().prepare('SELECT id, reauth_at FROM sessions WHERE user_id = ?').all(userId);
      const mine = rows.find(r => r.id === sessionIdOf(here));
      const other = rows.find(r => r.id === sessionIdOf(elsewhere));
      expect(mine.reauth_at).toBeGreaterThanOrEqual(before);
      expect(other.reauth_at).toBeNull();

      // The other session of the same account does not inherit it.
      expect((await request(app).get('/api/admin/backup').set('Cookie', here)).status).toBe(200);
      const blocked = await request(app).get('/api/admin/backup').set('Cookie', elsewhere);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('reauth_required');
      expect(auditActions()).toContain('reauth_succeeded');
    });

    it('needs a session: no login, no API token', async () => {
      const userId = createUser('admin@test.com', { role: 'admin' });
      expect((await request(app).post('/api/auth/confirm-password').send({ password: PASSWORD })).status).toBe(401);

      const { token } = apiTokens.createToken(userId, 'lodgely');
      const res = await request(app).post('/api/auth/confirm-password').set('Authorization', `Bearer ${token}`).send({ password: PASSWORD });
      expect(res.status).toBe(403);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions WHERE reauth_at IS NOT NULL').get().n).toBe(0);
    });

    it('accepts the session token as a Bearer header too (it is still a real login)', async () => {
      createUser('admin@test.com', { role: 'admin' });
      const cookie = await login('admin@test.com');
      const raw = cookie.slice('token='.length);
      const res = await request(app).post('/api/auth/confirm-password').set('Authorization', `Bearer ${raw}`).send({ password: PASSWORD });
      expect(res.status).toBe(200);
    });

    it('refuses a wrong or missing password', async () => {
      createUser('admin@test.com', { role: 'admin' });
      const cookie = await login('admin@test.com');

      expect((await request(app).post('/api/auth/confirm-password').set('Cookie', cookie).send({})).status).toBe(400);
      expect((await request(app).post('/api/auth/confirm-password').set('Cookie', cookie).send({ password: 123 })).status).toBe(400);
      const wrong = await confirm(cookie, 'not-my-password');
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe('wrong_password');
      expect(getDb().prepare('SELECT reauth_at FROM sessions WHERE id = ?').get(sessionIdOf(cookie)).reauth_at).toBeNull();
      expect(auditActions()).toContain('reauth_failed');
    });

    it('counts wrong passwords toward the account lockout', async () => {
      createUser('admin@test.com', { role: 'admin' });
      const cookie = await login('admin@test.com');

      for (let i = 0; i < 4; i++) expect((await confirm(cookie, `wrong-${i}`)).status).toBe(401);
      expect(getDb().prepare('SELECT failures FROM login_failures WHERE email = ?').get('admin@test.com').failures).toBe(4);
      expect((await confirm(cookie, 'wrong-4')).status).toBe(401);

      // Five failures lock the account: a new browser can't sign in...
      const fresh = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: PASSWORD });
      expect(fresh.status).toBe(429);
      expect(fresh.body.code).toBe('account_locked');
      // ...and the session can't confirm either, even with the right password.
      const locked = await confirm(cookie);
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('account_locked');
      expect(auditActions()).toContain('login_locked');
    });

    it('a successful confirmation clears earlier failures', async () => {
      createUser('admin@test.com', { role: 'admin' });
      const cookie = await login('admin@test.com');
      await confirm(cookie, 'wrong');
      await confirm(cookie, 'wrong');
      expect((await confirm(cookie)).status).toBe(200);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM login_failures').get().n).toBe(0);
    });

    it('is rate-limited per account', async () => {
      createUser('admin@test.com', { role: 'admin' });
      const cookie = await login('admin@test.com');
      const loginGuard = require('../src/models/loginGuard');
      for (let i = 0; i < 10; i++) {
        expect((await confirm(cookie, `wrong-${i}`)).status).toBe(401);
        loginGuard.clearFailures('admin@test.com'); // keep the lockout out of the way
      }
      const limited = await confirm(cookie);
      expect(limited.status).toBe(429);
      expect(limited.body.code).not.toBe('account_locked');
    });

    it('needs only the password for an account with two-factor login', async () => {
      const userId = createUser('twofa@test.com', { role: 'admin', twofa: true });
      // A session as left by a completed code login.
      const { token } = sessions.createSession(userId, { headers: {}, ip: '127.0.0.1' });
      const cookie = `token=${token}`;
      expect((await request(app).get('/api/admin/backup').set('Cookie', cookie)).body.code).toBe('reauth_required');
      expect((await confirm(cookie)).status).toBe(200);
      expect((await request(app).get('/api/admin/backup').set('Cookie', cookie)).status).toBe(200);
    });
  });

  describe('guarded routes', () => {
    // Each guarded route: how to call it, and the status it answers once the
    // password was confirmed (proof that the guard let it through).
    const ROUTES = [
      ['GET /api/admin/backup', (cookie) => request(app).get('/api/admin/backup').set('Cookie', cookie), 200],
      ['GET /api/admin/backups/:filename', (cookie, ctx) => request(app).get(`/api/admin/backups/${ctx.backupFile}`).set('Cookie', cookie), 200],
      ['POST /api/admin/restore', (cookie, ctx) => request(app).post('/api/admin/restore').set('Cookie', cookie).send(ctx.backup), 200],
      ['POST /api/auth/users', (cookie) => request(app).post('/api/auth/users').set('Cookie', cookie).send({ email: 'new@test.com', password: 'a-new-users-passphrase' }), 201],
      ['PUT /api/auth/users/:id', (cookie, ctx) => request(app).put(`/api/auth/users/${ctx.otherId}`).set('Cookie', cookie).send({ role: 'admin' }), 200],
      ['POST /api/auth/users/:id/revoke-sessions', (cookie, ctx) => request(app).post(`/api/auth/users/${ctx.otherId}/revoke-sessions`).set('Cookie', cookie), 200],
      ['DELETE /api/auth/users/:id', (cookie, ctx) => request(app).delete(`/api/auth/users/${ctx.otherId}`).set('Cookie', cookie), 200],
      ['POST /api/auth/tokens', (cookie) => request(app).post('/api/auth/tokens').set('Cookie', cookie).send({ name: 'lodgely' }), 201],
    ];

    let ctx;
    beforeEach(async () => {
      createUser('admin@test.com', { role: 'admin' });
      const otherId = createUser('other@test.com');
      const { createBackup } = require('../src/models/backup');
      const backup = JSON.parse(JSON.stringify(createBackup(getDb())));
      // As the backup scheduler would have written it.
      const backupFile = 'openflow-backup-2026-11-06T00-00-00-000Z.json';
      fs.writeFileSync(path.join(backupDir, backupFile), JSON.stringify(backup));
      ctx = { otherId, backupFile, backup };
    });

    it.each(ROUTES)('%s needs a recent confirmation', async (_name, call, okStatus) => {
      const cookie = await login('admin@test.com');

      // A fresh login alone is not enough.
      const fresh = await call(cookie, ctx);
      expect(fresh.status).toBe(403);
      expect(fresh.body).toEqual({ error: expect.any(String), code: 'reauth_required' });

      // Expired: confirmed a little over 10 minutes ago.
      setReauthAt(cookie, Date.now() - REAUTH_WINDOW_MS - 1000);
      const expired = await call(cookie, ctx);
      expect(expired.status).toBe(403);
      expect(expired.body.code).toBe('reauth_required');

      // Still inside the window.
      setReauthAt(cookie, Date.now() - REAUTH_WINDOW_MS + 30 * 1000);
      expect((await call(cookie, ctx)).status).toBe(okStatus);
    });

    it.each(ROUTES)('%s works after POST /api/auth/confirm-password', async (_name, call, okStatus) => {
      const cookie = await login('admin@test.com');
      expect((await confirm(cookie)).status).toBe(200);
      expect((await call(cookie, ctx)).status).toBe(okStatus);
    });

    it('nothing happened when the guard refused', async () => {
      const cookie = await login('admin@test.com');
      await request(app).post('/api/auth/users').set('Cookie', cookie).send({ email: 'new@test.com', password: 'a-new-users-passphrase' });
      await request(app).put(`/api/auth/users/${ctx.otherId}`).set('Cookie', cookie).send({ role: 'admin' });
      await request(app).delete(`/api/auth/users/${ctx.otherId}`).set('Cookie', cookie);
      await request(app).post('/api/auth/tokens').set('Cookie', cookie).send({ name: 'lodgely' });
      const db = getDb();
      expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('new@test.com').n).toBe(0);
      expect(db.prepare('SELECT role FROM users WHERE id = ?').get(ctx.otherId).role).toBe('user');
      expect(db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get().n).toBe(0);
      expect(auditActions()).not.toContain('backup_downloaded');
    });

    it('a non-admin creating their own API token confirms too', async () => {
      const cookie = await login('other@test.com');
      const res = await request(app).post('/api/auth/tokens').set('Cookie', cookie).send({ name: 'lodgely' });
      expect(res.body.code).toBe('reauth_required');
      expect((await confirm(cookie)).status).toBe(200);
      expect((await request(app).post('/api/auth/tokens').set('Cookie', cookie).send({ name: 'lodgely' })).status).toBe(201);
    });

    it('still checks admin rights first, so a confirmed non-admin gets 403 as before', async () => {
      const cookie = await login('other@test.com');
      expect((await confirm(cookie)).status).toBe(200);
      const res = await request(app).get('/api/admin/backup').set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.code).toBeUndefined();
    });
  });

  describe('left alone', () => {
    it('lodgely\'s reads keep working with an API token and with the password-login fallback', async () => {
      const ownerId = createUser('owner@test.com');
      const formId = uuid();
      getDb().prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
        .run(formId, ownerId, 'Leads', 'leads', JSON.stringify([{ id: 'f1', key: 'name', type: 'text', label: 'Name' }]));
      getDb().prepare('INSERT INTO submissions (id, form_id, data) VALUES (?, ?, ?)').run(uuid(), formId, JSON.stringify({ f1: 'Ada' }));

      const { token } = apiTokens.createToken(ownerId, 'lodgely');
      const cookie = await login('owner@test.com');
      const sessionToken = cookie.slice('token='.length);

      for (const bearer of [token, sessionToken]) {
        const auth = { Authorization: `Bearer ${bearer}` };
        const list = await request(app).get('/api/forms').set(auth);
        expect(list.status).toBe(200);
        expect(list.body.forms.map(f => f.id)).toEqual([formId]);
        const one = await request(app).get(`/api/forms/${formId}`).set(auth);
        expect(one.status).toBe(200);
        expect(one.body.form.steps[0].id).toBe('f1');
        const subs = await request(app).get(`/api/submissions/${formId}`).set(auth);
        expect(subs.status).toBe(200);
        expect(subs.body.submissions[0].data).toEqual({ f1: 'Ada' });
      }
    });

    it('everyday admin reads and token listing/revoking do not ask', async () => {
      const adminId = createUser('admin@test.com', { role: 'admin' });
      const cookie = await login('admin@test.com');
      for (const p of ['/api/auth/users', '/api/admin/backup/info', '/api/admin/backups', '/api/admin/audit-log', '/api/auth/tokens', '/api/auth/me']) {
        expect((await request(app).get(p).set('Cookie', cookie)).status).toBe(200);
      }
      const created = apiTokens.createToken(adminId, 'old');
      expect((await request(app).delete(`/api/auth/tokens/${created.id}`).set('Cookie', cookie)).status).toBe(200);
    });
  });
});
