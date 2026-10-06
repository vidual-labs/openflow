const request = require('supertest');
const bcrypt = require('bcryptjs');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const {
  slugifyKey, baseKey, ensureFieldKeys, validateFieldKeys, prepareSteps, fieldIdResolver,
} = require('../src/utils/fieldKeys');
const { visibleSteps } = require('../src/utils/conditions');

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

describe('field key derivation', () => {
  it('slugifies labels incl. German umlauts and leading digits', () => {
    expect(slugifyKey('Vorname')).toBe('vorname');
    expect(slugifyKey('Straße & Hausnummer')).toBe('strasse_hausnummer');
    expect(slugifyKey('Größe (m²)')).toBe('groesse_m'); // the superscript is not a digit
    expect(slugifyKey('E-Mail Adresse')).toBe('e_mail_adresse');
    expect(slugifyKey('2nd choice')).toBe('f_2nd_choice');
    expect(slugifyKey('Café crème')).toBe('cafe_creme');
    expect(slugifyKey('???')).toBe('');
    expect(slugifyKey('x'.repeat(60))).toHaveLength(40);
  });

  it('uses the type name for contact fields and the label otherwise', () => {
    expect(baseKey({ type: 'email', label: 'Work e-mail' })).toBe('email');
    expect(baseKey({ type: 'phone', label: 'Telefon' })).toBe('phone');
    expect(baseKey({ type: 'address' })).toBe('address');
    expect(baseKey({ type: 'text', label: 'Budget' })).toBe('budget');
    expect(baseKey({ type: 'select', question: 'Which plan?' })).toBe('which_plan');
    expect(baseKey({ type: 'rating' })).toBe('rating');
  });

  it('gives every leaf field a unique key, incl. group and address sub-fields', () => {
    const steps = ensureFieldKeys([
      { id: 'a', type: 'text', label: 'Name' },
      { id: 'g', type: 'group', fields: [
        { id: 'b', type: 'text', label: 'Name' },
        { id: 'c', type: 'email', label: 'Email' },
      ] },
      { id: 'd', type: 'email', label: 'Second email' },
      { id: 'e', type: 'address', customFields: [{ id: 'cf1', type: 'text', label: 'Floor' }] },
      { id: 'f', type: 'text', key: 'kept', label: 'Whatever' },
    ]);
    expect(steps[0].key).toBe('name');
    expect(steps[1].key).toBeUndefined(); // the group itself is not a field
    expect(steps[1].fields.map(f => f.key)).toEqual(['name_2', 'email']);
    expect(steps[2].key).toBe('email_2');
    expect(steps[3].key).toBe('address');
    expect(steps[3].customFields[0].key).toBe('floor');
    expect(steps[4].key).toBe('kept');
  });

  it('keeps the suffix inside the 40-character limit', () => {
    const label = 'y'.repeat(50);
    const steps = ensureFieldKeys([
      { id: 'a', type: 'text', label },
      { id: 'b', type: 'text', label },
    ]);
    expect(steps[0].key).toHaveLength(40);
    expect(steps[1].key).toHaveLength(40);
    expect(steps[1].key.endsWith('_2')).toBe(true);
  });

  it('refuses malformed and duplicate keys, naming them', () => {
    expect(validateFieldKeys([{ id: 'a', key: 'Bad Key' }])).toMatch(/"Bad Key" is invalid/);
    expect(validateFieldKeys([{ id: 'a', key: 'email' }, { id: 'b', key: 'email' }])).toMatch(/"email" is used by more than one field/);
    expect(validateFieldKeys([{ id: 'a', key: 'email' }, { id: 'b' }])).toBeNull();
  });

  it('rewrites id-based conditions to keys and refuses dangling ones', () => {
    const ok = prepareSteps([
      { id: 'field_1', type: 'select', label: 'Plan' },
      { id: 'field_2', type: 'text', label: 'Why', condition: { field: 'field_1', op: 'equals', value: 'pro' } },
    ]);
    expect(ok.steps[1].condition.field).toBe('plan');

    const bad = prepareSteps([
      { id: 'field_1', type: 'select', key: 'plan', label: 'Plan' },
      { id: 'field_2', type: 'text', label: 'Why', condition: { field: 'plan_old', op: 'equals', value: 'pro' } },
    ]);
    expect(bad.error).toMatch(/"Why".*"plan_old"/);

    // The boot migration is lenient: dangling references are left alone.
    const lenient = prepareSteps([
      { id: 'field_2', type: 'text', label: 'Why', condition: { field: 'gone', op: 'equals', value: 'pro' } },
    ], { strict: false });
    expect(lenient.steps[0].condition.field).toBe('gone');
  });

  it('evaluates conditions by key with an id fallback', () => {
    const steps = [
      { id: 'field_1', key: 'plan', type: 'select' },
      { id: 'field_2', key: 'why', type: 'text', condition: { field: 'plan', op: 'equals', value: 'pro' } },
      { id: 'field_3', key: 'legacy', type: 'text', condition: { field: 'field_1', op: 'equals', value: 'pro' } },
    ];
    expect(visibleSteps(steps, { field_1: 'pro' }).map(s => s.id)).toEqual(['field_1', 'field_2', 'field_3']);
    expect(visibleSteps(steps, { field_1: 'basic' }).map(s => s.id)).toEqual(['field_1']);
    expect(fieldIdResolver(steps)('plan')).toBe('field_1');
    expect(fieldIdResolver(steps)('unknown')).toBe('unknown');
  });
});

describe('field keys over the API', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });

  it('fills missing keys on create and returns them', async () => {
    seedUser();
    const cookie = await login(app);
    const res = await request(app).post('/api/forms').set('Cookie', cookie).send({
      title: 'Keys',
      steps: [
        { id: 'field_1', type: 'text', label: 'Vorname' },
        { id: 'field_2', type: 'email', label: 'E-Mail' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.form.steps.map(s => s.key)).toEqual(['vorname', 'email']);
  });

  it('refuses a duplicate key on update with a 400 naming it', async () => {
    const userId = seedUser();
    const db = getDb();
    const formId = uuid();
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps) VALUES (?, ?, ?, ?, ?)')
      .run(formId, userId, 'F', 'keys-dupe', '[]');
    const cookie = await login(app);
    const res = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({
      steps: [
        { id: 'field_1', type: 'text', key: 'budget', label: 'Budget' },
        { id: 'field_2', type: 'text', key: 'budget', label: 'Budget again' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"budget"/);
    expect(JSON.parse(db.prepare('SELECT steps FROM forms WHERE id = ?').get(formId).steps)).toEqual([]);
  });

  it('refuses a malformed key and a condition on a renamed key', async () => {
    const userId = seedUser();
    const db = getDb();
    const formId = uuid();
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps) VALUES (?, ?, ?, ?, ?)')
      .run(formId, userId, 'F', 'keys-bad', '[]');
    const cookie = await login(app);

    const malformed = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({
      steps: [{ id: 'field_1', type: 'text', key: 'Not-Valid', label: 'X' }],
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toMatch(/"Not-Valid" is invalid/);

    const renamed = await request(app).put(`/api/forms/${formId}`).set('Cookie', cookie).send({
      steps: [
        { id: 'field_1', type: 'select', key: 'plan_new', label: 'Plan' },
        { id: 'field_2', type: 'text', key: 'why', label: 'Why', condition: { field: 'plan', op: 'equals', value: 'pro' } },
      ],
    });
    expect(renamed.status).toBe(400);
    expect(renamed.body.error).toMatch(/"Why".*"plan"/);
  });

  it('skips a step hidden by a key-based condition on submit', async () => {
    const userId = seedUser();
    const db = getDb();
    const formId = uuid();
    const steps = [
      { id: 'field_1', key: 'plan', type: 'select', label: 'Plan', options: ['basic', 'pro'] },
      { id: 'field_2', key: 'why', type: 'text', label: 'Why', required: true, condition: { field: 'plan', op: 'equals', value: 'pro' } },
    ];
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
      .run(formId, userId, 'F', 'keys-submit', JSON.stringify(steps));

    const hidden = await request(app).post('/api/public/form/keys-submit/submit').send({ data: { field_1: 'basic', field_2: 'stale' } });
    expect(hidden.status).toBe(201);
    const stored = JSON.parse(db.prepare('SELECT data FROM submissions WHERE form_id = ?').get(formId).data);
    expect(stored).toEqual({ field_1: 'basic' });

    const shown = await request(app).post('/api/public/form/keys-submit/submit').send({ data: { field_1: 'pro' } });
    expect(shown.status).toBe(400);
    expect(shown.body.error).toMatch(/Why/);
  });
});

describe('field key boot migration', () => {
  it('adds keys to existing forms and points conditions at them', () => {
    const userId = seedUser();
    const db = getDb();
    const formId = uuid();
    const legacy = [
      { id: 'field_1', type: 'text', label: 'Name' },
      { id: 'field_2', type: 'text', label: 'Name', condition: { field: 'field_1', op: 'is_set' } },
      { id: 'group_1', type: 'group', fields: [{ id: 'field_3', type: 'phone', label: 'Tel' }] },
    ];
    db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(formId, userId, 'Old', 'old-form', JSON.stringify(legacy), '2020-01-01 00:00:00');

    const { ensureFormFieldKeys } = require('../src/models/db');
    expect(ensureFormFieldKeys(db)).toBe(1);
    const row = db.prepare('SELECT steps, updated_at FROM forms WHERE id = ?').get(formId);
    const steps = JSON.parse(row.steps);
    expect(steps[0].key).toBe('name');
    expect(steps[1].key).toBe('name_2');
    expect(steps[1].condition.field).toBe('name');
    expect(steps[2].fields[0].key).toBe('phone');
    expect(row.updated_at).toBe('2020-01-01 00:00:00');

    // Idempotent: a second run touches nothing.
    expect(ensureFormFieldKeys(db)).toBe(0);
  });
});
