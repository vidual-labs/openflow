const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const systemMail = require('../src/models/systemMail');
const loginGuard = require('../src/models/loginGuard');
const { resetRateLimits } = require('../src/models/rateLimit');

function getDb() {
  return require('../src/models/db').getDb();
}

const PASSWORD = 'correct-horse-battery';

function createUser(email, { role = 'user', password = PASSWORD, twofa = false } = {}) {
  const id = uuid();
  getDb().prepare('INSERT INTO users (id, email, password_hash, role, twofa_enabled) VALUES (?, ?, ?, ?, ?)')
    .run(id, email, bcrypt.hashSync(password, 10), role, twofa ? 1 : 0);
  return id;
}

// In-memory SMTP: every "sent" mail lands in `sent`.
let sent = [];
let failSending = false;
function lastCode() {
  const mail = sent[sent.length - 1];
  const match = mail && mail.text.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

const MAIL_ENV = { SMTP_HOST: 'smtp.test.local', SMTP_FROM: 'OpenFlow <no-reply@test.local>' };

describe('Login security', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
    systemMail.setTransportForTests({
      sendMail: async (msg) => {
        if (failSending) throw new Error('SMTP down');
        sent.push(msg);
      },
      verify: async () => true,
    });
  });

  afterAll(() => {
    systemMail.setTransportForTests(null);
  });

  beforeEach(() => {
    sent = [];
    failSending = false;
    Object.assign(process.env, MAIL_ENV);
    delete process.env.OPENFLOW_2FA_DISABLED;
  });

  afterEach(() => {
    for (const k of Object.keys(MAIL_ENV)) delete process.env[k];
    delete process.env.OPENFLOW_2FA_DISABLED;
  });

  describe('server-side sessions', () => {
    it('logout ends the session on the server, not just in the browser', async () => {
      createUser('s1@test.com');
      const login = await request(app).post('/api/auth/login').send({ email: 's1@test.com', password: PASSWORD });
      expect(login.status).toBe(200);
      const cookie = login.headers['set-cookie'];
      const session = cookie.find(c => c.startsWith('token=')).split(';')[0];

      expect((await request(app).get('/api/auth/me').set('Cookie', session)).status).toBe(200);
      await request(app).post('/api/auth/logout').set('Cookie', session);
      // Replaying the captured cookie no longer works.
      expect((await request(app).get('/api/auth/me').set('Cookie', session)).status).toBe(401);
    });

    it('accepts the session token as a Bearer header (lodgely login fallback)', async () => {
      createUser('s2@test.com');
      const login = await request(app).post('/api/auth/login').send({ email: 's2@test.com', password: PASSWORD });
      const token = login.headers['set-cookie'].find(c => c.startsWith('token=')).split(';')[0].slice('token='.length);
      const res = await request(app).get('/api/forms').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('stores only a hash of the session token', async () => {
      createUser('s3@test.com');
      const login = await request(app).post('/api/auth/login').send({ email: 's3@test.com', password: PASSWORD });
      const token = login.headers['set-cookie'].find(c => c.startsWith('token=')).split(';')[0].slice('token='.length);
      const rows = getDb().prepare('SELECT token_hash FROM sessions').all();
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toBe(token);
    });

    it('rejects a pre-0.44 JWT cookie', async () => {
      const res = await request(app).get('/api/auth/me')
        .set('Cookie', 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ4In0.sig');
      expect(res.status).toBe(401);
    });

    it('matches the e-mail case-insensitively', async () => {
      createUser('Mixed.Case@test.com');
      const res = await request(app).post('/api/auth/login').send({ email: 'mixed.case@TEST.com', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('Mixed.Case@test.com');
    });

    it('marks auth responses as not cacheable', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'x@test.com', password: 'nope' });
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('account lockout', () => {
    async function fail(email, times, agent = request(app)) {
      for (let i = 0; i < times; i++) {
        await agent.post('/api/auth/login').send({ email, password: 'wrong-password' });
      }
    }

    it('locks the account after 5 failures, even for the right password', async () => {
      createUser('lock@test.com');
      await fail('lock@test.com', 5);
      const res = await request(app).post('/api/auth/login').send({ email: 'lock@test.com', password: PASSWORD });
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('account_locked');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('treats unknown e-mails exactly like real ones', async () => {
      await fail('ghost@test.com', 5);
      const res = await request(app).post('/api/auth/login').send({ email: 'ghost@test.com', password: PASSWORD });
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('account_locked');
    });

    it('survives a restart (it is stored in the DB, not in memory)', async () => {
      createUser('persist@test.com');
      await fail('persist@test.com', 5);
      resetRateLimits(); // what a restart does to the in-memory limiter
      const res = await request(app).post('/api/auth/login').send({ email: 'persist@test.com', password: PASSWORD });
      expect(res.status).toBe(429);
    });

    it('does not lock out a browser that has signed in to the account before', async () => {
      createUser('known@test.com');
      const browser = request.agent(app);
      expect((await browser.post('/api/auth/login').send({ email: 'known@test.com', password: PASSWORD })).status).toBe(200);

      await fail('known@test.com', 5); // an attacker elsewhere
      expect((await request(app).post('/api/auth/login').send({ email: 'known@test.com', password: PASSWORD })).status).toBe(429);
      expect((await browser.post('/api/auth/login').send({ email: 'known@test.com', password: PASSWORD })).status).toBe(200);
    });

    it('escalates the lock: 1, 5, 15, then 60 minutes', () => {
      expect(loginGuard.lockMinutes(4)).toBe(0);
      expect(loginGuard.lockMinutes(5)).toBe(1);
      expect(loginGuard.lockMinutes(10)).toBe(5);
      expect(loginGuard.lockMinutes(15)).toBe(15);
      expect(loginGuard.lockMinutes(20)).toBe(60);
      expect(loginGuard.lockMinutes(50)).toBe(60);
    });

    it('resets the count after a successful login', async () => {
      createUser('reset@test.com');
      await fail('reset@test.com', 4);
      expect((await request(app).post('/api/auth/login').send({ email: 'reset@test.com', password: PASSWORD })).status).toBe(200);
      await fail('reset@test.com', 4);
      expect((await request(app).post('/api/auth/login').send({ email: 'reset@test.com', password: PASSWORD })).status).toBe(200);
    });

    it('e-mails the owner once the lockout reaches 10 failures', async () => {
      createUser('notify@test.com');
      await fail('notify@test.com', 5);
      // Fast-forward past the first lock.
      getDb().prepare('UPDATE login_failures SET locked_until = 0').run();
      await fail('notify@test.com', 5);
      await new Promise(r => setImmediate(r));
      expect(sent.some(m => m.to === 'notify@test.com' && /Failed sign-in attempts/.test(m.subject))).toBe(true);
    });
  });

  describe('two-factor login (e-mailed code)', () => {
    async function enable2fa(agent) {
      const start = await agent.post('/api/auth/2fa/start').send({ password: PASSWORD });
      expect(start.status).toBe(200);
      const confirm = await agent.post('/api/auth/2fa/confirm').send({ challenge: start.body.challenge, code: lastCode() });
      expect(confirm.status).toBe(200);
    }

    it('enabling needs the password and a code that actually arrived', async () => {
      createUser('enable@test.com');
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: 'enable@test.com', password: PASSWORD });

      expect((await agent.post('/api/auth/2fa/start').send({ password: 'wrong-password' })).status).toBe(401);
      const start = await agent.post('/api/auth/2fa/start').send({ password: PASSWORD });
      expect(start.status).toBe(200);
      expect(start.body.email).toBe('e•••@test.com');
      expect(sent).toHaveLength(1);

      const wrong = await agent.post('/api/auth/2fa/confirm').send({ challenge: start.body.challenge, code: lastCode() === '000000' ? '111111' : '000000' });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('wrong_code');
      expect(getDb().prepare('SELECT twofa_enabled FROM users WHERE email = ?').get('enable@test.com').twofa_enabled).toBe(0);

      const ok = await agent.post('/api/auth/2fa/confirm').send({ challenge: start.body.challenge, code: lastCode() });
      expect(ok.status).toBe(200);
      expect((await agent.get('/api/auth/me')).body.user.twoFactorEnabled).toBe(true);
    });

    it('a new browser needs the e-mailed code; a remembered one does not', async () => {
      createUser('tfa@test.com', { twofa: true });
      const browser = request.agent(app);

      const step1 = await browser.post('/api/auth/login').send({ email: 'tfa@test.com', password: PASSWORD });
      expect(step1.status).toBe(200);
      expect(step1.body.twoFactorRequired).toBe(true);
      expect(step1.body.user).toBeUndefined();
      expect((step1.headers['set-cookie'] || []).some(c => c.startsWith('token='))).toBe(false);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('tfa@test.com');

      const step2 = await browser.post('/api/auth/login/verify').send({ challenge: step1.body.challenge, code: lastCode(), remember: true });
      expect(step2.status).toBe(200);
      expect(step2.body.user.email).toBe('tfa@test.com');
      expect((await browser.get('/api/auth/me')).status).toBe(200);

      // Logged out and back in from the same browser: password is enough.
      await browser.post('/api/auth/logout');
      const again = await browser.post('/api/auth/login').send({ email: 'tfa@test.com', password: PASSWORD });
      expect(again.body.user.email).toBe('tfa@test.com');
      expect(sent).toHaveLength(1);

      // Another browser still needs a code.
      const other = await request(app).post('/api/auth/login').send({ email: 'tfa@test.com', password: PASSWORD });
      expect(other.body.twoFactorRequired).toBe(true);
    });

    it('does not remember the browser when "remember" is off', async () => {
      createUser('noremember@test.com', { twofa: true });
      const browser = request.agent(app);
      const step1 = await browser.post('/api/auth/login').send({ email: 'noremember@test.com', password: PASSWORD });
      await browser.post('/api/auth/login/verify').send({ challenge: step1.body.challenge, code: lastCode(), remember: false });
      await browser.post('/api/auth/logout');
      const again = await browser.post('/api/auth/login').send({ email: 'noremember@test.com', password: PASSWORD });
      expect(again.body.twoFactorRequired).toBe(true);
    });

    it('a code works once, and five wrong tries burn it', async () => {
      createUser('burn@test.com', { twofa: true });
      const step1 = await request(app).post('/api/auth/login').send({ email: 'burn@test.com', password: PASSWORD });
      const code = lastCode();
      const wrongCode = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i++) {
        const r = await request(app).post('/api/auth/login/verify').send({ challenge: step1.body.challenge, code: wrongCode });
        expect(r.body.code).toBe('wrong_code');
      }
      const fifth = await request(app).post('/api/auth/login/verify').send({ challenge: step1.body.challenge, code: wrongCode });
      expect(fifth.body.code).toBe('challenge_invalid');
      const late = await request(app).post('/api/auth/login/verify').send({ challenge: step1.body.challenge, code });
      expect(late.status).toBe(401);

      const fresh = await request(app).post('/api/auth/login').send({ email: 'burn@test.com', password: PASSWORD });
      const ok = await request(app).post('/api/auth/login/verify').send({ challenge: fresh.body.challenge, code: lastCode() });
      expect(ok.status).toBe(200);
      const replay = await request(app).post('/api/auth/login/verify').send({ challenge: fresh.body.challenge, code: lastCode() });
      expect(replay.status).toBe(401);
    });

    it('only the newest code is valid', async () => {
      createUser('newest@test.com', { twofa: true });
      const first = await request(app).post('/api/auth/login').send({ email: 'newest@test.com', password: PASSWORD });
      const firstCode = lastCode();
      await request(app).post('/api/auth/login').send({ email: 'newest@test.com', password: PASSWORD });
      const res = await request(app).post('/api/auth/login/verify').send({ challenge: first.body.challenge, code: firstCode });
      expect(res.status).toBe(401);
    });

    it('caps how many codes are sent', async () => {
      createUser('flood@test.com', { twofa: true });
      for (let i = 0; i < 5; i++) {
        expect((await request(app).post('/api/auth/login').send({ email: 'flood@test.com', password: PASSWORD })).body.twoFactorRequired).toBe(true);
      }
      const sixth = await request(app).post('/api/auth/login').send({ email: 'flood@test.com', password: PASSWORD });
      expect(sixth.status).toBe(429);
      expect(sent).toHaveLength(5);
    });

    it('a wrong password never sends a code', async () => {
      createUser('nocode@test.com', { twofa: true });
      const res = await request(app).post('/api/auth/login').send({ email: 'nocode@test.com', password: 'wrong-password' });
      expect(res.status).toBe(401);
      expect(sent).toHaveLength(0);
    });

    it('answers 503 (and keeps the send budget) when the mail cannot be sent', async () => {
      createUser('smtpdown@test.com', { twofa: true });
      failSending = true;
      const res = await request(app).post('/api/auth/login').send({ email: 'smtpdown@test.com', password: PASSWORD });
      expect(res.status).toBe(503);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM auth_challenges').get().n).toBe(0);
    });

    it('answers 503 when SMTP is not configured at all', async () => {
      createUser('nosmtp@test.com', { twofa: true });
      delete process.env.SMTP_HOST;
      const res = await request(app).post('/api/auth/login').send({ email: 'nosmtp@test.com', password: PASSWORD });
      expect(res.status).toBe(503);
    });

    it('OPENFLOW_2FA_DISABLED lets 2FA accounts in with the password (operator escape hatch)', async () => {
      createUser('escape@test.com', { twofa: true });
      process.env.OPENFLOW_2FA_DISABLED = 'true';
      const res = await request(app).post('/api/auth/login').send({ email: 'escape@test.com', password: PASSWORD });
      expect(res.body.user.email).toBe('escape@test.com');
    });

    it('cannot be enabled without SMTP', async () => {
      createUser('cant@test.com');
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: 'cant@test.com', password: PASSWORD });
      delete process.env.SMTP_HOST;
      expect((await agent.post('/api/auth/2fa/start').send({ password: PASSWORD })).status).toBe(409);
      expect((await agent.get('/api/auth/account')).body.twoFactor.available).toBe(false);
    });

    it('disabling needs the password and e-mails a notice', async () => {
      createUser('off@test.com');
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: 'off@test.com', password: PASSWORD });
      await enable2fa(agent);
      expect((await agent.post('/api/auth/2fa/disable').send({ password: 'wrong-password' })).status).toBe(401);
      expect((await agent.post('/api/auth/2fa/disable').send({ password: PASSWORD })).status).toBe(200);
      await new Promise(r => setImmediate(r));
      expect(sent.some(m => /turned off/.test(m.subject))).toBe(true);
      expect((await agent.get('/api/auth/me')).body.user.twoFactorEnabled).toBe(false);
    });

    it('browsers remembered before 2FA was enabled must use a code', async () => {
      createUser('before@test.com');
      const oldBrowser = request.agent(app);
      await oldBrowser.post('/api/auth/login').send({ email: 'before@test.com', password: PASSWORD });
      const newBrowser = request.agent(app);
      await newBrowser.post('/api/auth/login').send({ email: 'before@test.com', password: PASSWORD });
      await enable2fa(newBrowser);

      await oldBrowser.post('/api/auth/logout');
      expect((await oldBrowser.post('/api/auth/login').send({ email: 'before@test.com', password: PASSWORD })).body.twoFactorRequired).toBe(true);
      await newBrowser.post('/api/auth/logout');
      expect((await newBrowser.post('/api/auth/login').send({ email: 'before@test.com', password: PASSWORD })).body.user).toBeDefined();
    });

    it('an admin can switch off a user\'s 2FA; "log out everywhere" forgets remembered browsers', async () => {
      createUser('boss@test.com', { role: 'admin' });
      const userId = createUser('lost@test.com', { twofa: true });
      const admin = request.agent(app);
      await admin.post('/api/auth/login').send({ email: 'boss@test.com', password: PASSWORD });

      const browser = request.agent(app);
      const s1 = await browser.post('/api/auth/login').send({ email: 'lost@test.com', password: PASSWORD });
      await browser.post('/api/auth/login/verify').send({ challenge: s1.body.challenge, code: lastCode() });

      expect((await admin.post(`/api/auth/users/${userId}/revoke-sessions`)).status).toBe(200);
      expect((await browser.get('/api/auth/me')).status).toBe(401);
      expect((await browser.post('/api/auth/login').send({ email: 'lost@test.com', password: PASSWORD })).body.twoFactorRequired).toBe(true);

      expect((await admin.put(`/api/auth/users/${userId}`).send({ twoFactor: false })).body.user.twoFactorEnabled).toBe(false);
      expect((await browser.post('/api/auth/login').send({ email: 'lost@test.com', password: PASSWORD })).body.user).toBeDefined();
    });
  });

  describe('self-service password change', () => {
    it('checks the current password and refuses weak new ones', async () => {
      createUser('pw@test.com');
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: 'pw@test.com', password: PASSWORD });

      expect((await agent.post('/api/auth/password').send({ currentPassword: 'wrong-password', newPassword: 'another-long-passphrase' })).status).toBe(401);
      expect((await agent.post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: 'Password2026!' })).status).toBe(400);
      expect((await agent.post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: PASSWORD })).status).toBe(400);
    });

    it('keeps this browser signed in and signs out every other session', async () => {
      createUser('pw2@test.com');
      const here = request.agent(app);
      await here.post('/api/auth/login').send({ email: 'pw2@test.com', password: PASSWORD });
      const elsewhere = request.agent(app);
      await elsewhere.post('/api/auth/login').send({ email: 'pw2@test.com', password: PASSWORD });

      const res = await here.post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-passphrase' });
      expect(res.status).toBe(200);
      expect((await here.get('/api/auth/me')).status).toBe(200);
      expect((await elsewhere.get('/api/auth/me')).status).toBe(401);
      expect((await request(app).post('/api/auth/login').send({ email: 'pw2@test.com', password: 'a-brand-new-passphrase' })).status).toBe(200);
    });

    it('stores new passwords at the configured bcrypt cost and upgrades old hashes on login', async () => {
      process.env.BCRYPT_ROUNDS = '11';
      try {
        createUser('cost@test.com'); // cost 10
        await request(app).post('/api/auth/login').send({ email: 'cost@test.com', password: PASSWORD });
        // The upgrade runs in the background after the response.
        for (let i = 0; i < 50; i++) {
          const hash = getDb().prepare('SELECT password_hash FROM users WHERE email = ?').get('cost@test.com').password_hash;
          if (bcrypt.getRounds(hash) === 11) break;
          await new Promise(r => setTimeout(r, 20));
        }
        const hash = getDb().prepare('SELECT password_hash FROM users WHERE email = ?').get('cost@test.com').password_hash;
        expect(bcrypt.getRounds(hash)).toBe(11);
        expect((await request(app).post('/api/auth/login').send({ email: 'cost@test.com', password: PASSWORD })).status).toBe(200);
      } finally {
        process.env.BCRYPT_ROUNDS = '10';
      }
    });
  });

  describe('sessions and remembered browsers', () => {
    it('lists sessions and signs out everywhere else', async () => {
      createUser('list@test.com');
      const here = request.agent(app);
      await here.post('/api/auth/login').set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/130.0 Safari/537.36').send({ email: 'list@test.com', password: PASSWORD });
      const elsewhere = request.agent(app);
      await elsewhere.post('/api/auth/login').send({ email: 'list@test.com', password: PASSWORD });

      const account = await here.get('/api/auth/account');
      expect(account.body.sessions).toHaveLength(2);
      expect(account.body.sessions.filter(s => s.current)).toHaveLength(1);
      expect(account.body.devices).toHaveLength(2);
      expect(account.body.devices.find(d => d.current).client).toBe('Chrome on macOS');

      expect((await here.post('/api/auth/sessions/revoke-others')).status).toBe(200);
      expect((await elsewhere.get('/api/auth/me')).status).toBe(401);
      const after = await here.get('/api/auth/account');
      expect(after.body.sessions).toHaveLength(1);
      expect(after.body.devices).toHaveLength(1);
    });

    it('cannot end another user\'s session', async () => {
      createUser('a@test.com');
      createUser('b@test.com');
      const a = request.agent(app);
      await a.post('/api/auth/login').send({ email: 'a@test.com', password: PASSWORD });
      const b = request.agent(app);
      await b.post('/api/auth/login').send({ email: 'b@test.com', password: PASSWORD });
      const bSession = (await b.get('/api/auth/account')).body.sessions[0].id;
      expect((await a.delete(`/api/auth/sessions/${bSession}`)).status).toBe(404);
      expect((await b.get('/api/auth/me')).status).toBe(200);
    });

    it('is off-limits to API tokens', async () => {
      createUser('tok@test.com');
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: 'tok@test.com', password: PASSWORD });
      const { token } = (await agent.post('/api/auth/tokens').send({ name: 'ci' })).body.token;
      const res = await request(app).get('/api/auth/account').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('deleting a user removes their sessions', async () => {
      createUser('boss2@test.com', { role: 'admin' });
      const goneId = createUser('gone@test.com');
      const admin = request.agent(app);
      await admin.post('/api/auth/login').send({ email: 'boss2@test.com', password: PASSWORD });
      await request(app).post('/api/auth/login').send({ email: 'gone@test.com', password: PASSWORD });
      expect((await admin.delete(`/api/auth/users/${goneId}`)).status).toBe(200);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(goneId).n).toBe(0);
    });
  });
});

describe('Password strength', () => {
  const { isAcceptableNewPassword } = require('../src/models/secureDefaults');

  it.each([
    'short',
    'aaaaaaaaaaaa',
    '1234567890',
    'qwertzuiop',
    'Password2026!',
    'Welcome123456',
    'admin!2345678',
    'x'.repeat(73),
  ])('rejects %s', (pw) => {
    expect(isAcceptableNewPassword(pw)).toBe(false);
  });

  it('rejects the account\'s own e-mail address or its local part', () => {
    expect(isAcceptableNewPassword('jane.doe@example.com', { email: 'jane.doe@example.com' })).toBe(false);
    expect(isAcceptableNewPassword('jane.doe2026', { email: 'jane.doe@example.com' })).toBe(false);
  });

  it.each(['correct-horse-battery', 'Tr0ub4dor&3-plus', 'mein langes Passwort'])('accepts %s', (pw) => {
    expect(isAcceptableNewPassword(pw, { email: 'someone@example.com' })).toBe(true);
  });
});

describe('Security headers', () => {
  const { securityHeaders } = require('../src/middleware/securityHeaders');
  const app = express();
  app.use((req, res, next) => {
    if (req.headers['x-test-subdomain']) req.subdomainForm = { slug: 'x' };
    next();
  });
  app.use(securityHeaders);
  app.get('*', (req, res) => res.send('ok'));

  it('locks down admin pages: strict CSP, no framing', async () => {
    const res = await request(app).get('/login');
    expect(res.headers['content-security-policy']).toMatch(/script-src 'self'(;|$)/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it.each(['/f/abc', '/embed/abc', '/api/public/form/abc'])('leaves public form page %s frameable and CSP-free (GTM, Pixel)', async (path) => {
    const res = await request(app).get(path);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('leaves per-form subdomains alone', async () => {
    const res = await request(app).get('/').set('X-Test-Subdomain', '1');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('sends HSTS only over HTTPS', async () => {
    expect((await request(app).get('/')).headers['strict-transport-security']).toBeUndefined();
    const https = express();
    https.set('trust proxy', true);
    https.use(securityHeaders);
    https.get('*', (req, res) => res.send('ok'));
    const res = await request(https).get('/').set('X-Forwarded-Proto', 'https');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
  });
});
