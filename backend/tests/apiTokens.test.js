const request = require('supertest');
const { createTestApp } = require('./setup');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

describe('API tokens', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  // Create a user and return a logged-in session cookie.
  async function loginUser(email = 'owner@test.com', password = 'ownerpass', role = 'admin') {
    const { getDb } = require('../src/models/db');
    getDb().prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(uuid(), email, bcrypt.hashSync(password, 10), role);
    const res = await request(app).post('/api/auth/login').send({ email, password });
    return res.headers['set-cookie'];
  }

  async function createToken(cookie, name = 'lodgely') {
    const res = await request(app).post('/api/auth/tokens').set('Cookie', cookie).send({ name });
    return res;
  }

  it('creates a token and returns the plaintext exactly once', async () => {
    const cookie = await loginUser();
    const res = await createToken(cookie, 'lodgely connector');

    expect(res.status).toBe(201);
    expect(res.body.token.token).toMatch(/^ofw_[0-9a-f]{40}$/);
    expect(res.body.token.name).toBe('lodgely connector');
    expect(res.body.token.token_prefix).toBe(res.body.token.token.slice(0, 12));
  });

  it('requires a name', async () => {
    const cookie = await loginUser();
    const res = await request(app).post('/api/auth/tokens').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });

  it('lists tokens without exposing the secret', async () => {
    const cookie = await loginUser();
    await createToken(cookie, 'one');

    const res = await request(app).get('/api/auth/tokens').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.tokens).toHaveLength(1);
    expect(res.body.tokens[0].name).toBe('one');
    expect(res.body.tokens[0].token).toBeUndefined();
    expect(res.body.tokens[0].token_hash).toBeUndefined();
  });

  it('authenticates a GET request with the token (read access)', async () => {
    const cookie = await loginUser();
    const { token } = (await createToken(cookie)).body.token;

    const res = await request(app).get('/api/forms').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.forms)).toBe(true);
  });

  it('rejects a write request made with a token (read-only)', async () => {
    const cookie = await loginUser();
    const { token } = (await createToken(cookie)).body.token;

    const res = await request(app)
      .post('/api/forms')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Nope' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/read-only/i);
  });

  it('cannot use a token to manage tokens (requires a session)', async () => {
    const cookie = await loginUser();
    const { token } = (await createToken(cookie)).body.token;

    const res = await request(app).get('/api/auth/tokens').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unknown token', async () => {
    const res = await request(app)
      .get('/api/forms')
      .set('Authorization', 'Bearer ofw_deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(res.status).toBe(401);
  });

  it('stops working once revoked', async () => {
    const cookie = await loginUser();
    const created = (await createToken(cookie)).body.token;

    const del = await request(app).delete(`/api/auth/tokens/${created.id}`).set('Cookie', cookie);
    expect(del.status).toBe(200);

    const res = await request(app).get('/api/forms').set('Authorization', `Bearer ${created.token}`);
    expect(res.status).toBe(401);
  });

  it('only scopes a token to its owner\'s forms', async () => {
    const ownerCookie = await loginUser('owner2@test.com', 'pass', 'admin');
    const { token } = (await createToken(ownerCookie)).body.token;

    // Owner creates a form.
    await request(app).post('/api/forms').set('Cookie', ownerCookie).send({ title: 'Mine' });

    const res = await request(app).get('/api/forms').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.forms).toHaveLength(1);
    expect(res.body.forms[0].title).toBe('Mine');
  });
});
