jest.mock('../src/models/calon', () => ({
  ...jest.requireActual('../src/models/calon'),
  fetchCalonAvailability: jest.fn(),
  submitCalonBooking: jest.fn(),
}));

const request = require('supertest');
const { randomUUID: uuid } = require('crypto');
const { createTestApp } = require('./setup');
const { fetchCalonAvailability, submitCalonBooking } = require('../src/models/calon');
const { processDueCalonBookings } = require('../src/models/calonBooking');

function getDb() {
  return require('../src/models/db').getDb();
}

const CALON = { enabled: true, baseUrl: 'https://calon.example.com', resourceSlug: 'consulting' };

function seedForm(steps) {
  const db = getDb();
  const userId = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(userId, `${userId}@test.com`, 'x', 'admin');
  const formId = uuid();
  db.prepare('INSERT INTO forms (id, user_id, title, slug, steps, published) VALUES (?, ?, ?, ?, ?, 1)')
    .run(formId, userId, 'Consultation', 'booking-form', JSON.stringify(steps));
  return formId;
}

const STEPS = [
  { id: 'when', type: 'date-timeslot', calon: CALON },
  { id: 'fullname', type: 'text', autocomplete: 'name' },
  { id: 'mail', type: 'email' },
  { id: 'tel', type: 'phone' },
];

const ANSWERS = { when: '2026-09-02 09:30 Europe/Berlin', fullname: 'Ada Lovelace', mail: 'ada@example.com', tel: '+49 151 1' };

function storedSubmissions() {
  return getDb().prepare('SELECT * FROM submissions').all()
    .map(r => ({ ...r, metadata: JSON.parse(r.metadata) }));
}

describe('POST /api/public/form/:slug/submit with a calon-connected timeslot', () => {
  let app;
  beforeAll(() => { app = createTestApp(); });
  beforeEach(() => {
    fetchCalonAvailability.mockReset();
    submitCalonBooking.mockReset();
  });

  it('books the slot in calon, then stores the submission with the booking id', async () => {
    const formId = seedForm(STEPS);
    submitCalonBooking.mockResolvedValue({ accepted: true, bookingId: 'bk_1' });

    const res = await request(app).post('/api/public/form/booking-form/submit').send({ data: ANSWERS });

    expect(res.status).toBe(201);
    expect(submitCalonBooking).toHaveBeenCalledTimes(1);
    const { baseUrl, booking } = submitCalonBooking.mock.calls[0][0];
    expect(baseUrl).toBe('https://calon.example.com');
    expect(booking).toEqual(expect.objectContaining({
      resource_slug: 'consulting',
      start: '2026-09-02T09:30:00+02:00',
      timezone: 'Europe/Berlin',
      requester: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+49 151 1' },
      subject: 'Consultation: Ada Lovelace',
      source_ref: `openflow:${formId}:${res.body.id}:when`,
    }));
    const [sub] = storedSubmissions();
    expect(sub.metadata.calonBookings).toEqual({ when: { status: 'booked', bookingId: 'bk_1' } });
    expect(sub.metadata.calonPending).toBeUndefined();
  });

  it('uses the name/email/phone fields picked in the editor over the automatic choice', async () => {
    seedForm([
      { id: 'when', type: 'date-timeslot', calon: { ...CALON, nameFieldId: 'company', emailFieldId: 'mail2' } },
      { id: 'company', type: 'text' },
      { id: 'mail', type: 'email' },
      { id: 'mail2', type: 'email' },
    ]);
    submitCalonBooking.mockResolvedValue({ accepted: true, bookingId: 'bk_2' });

    await request(app).post('/api/public/form/booking-form/submit')
      .send({ data: { when: ANSWERS.when, company: 'ACME', mail: 'a@example.com', mail2: 'b@example.com' } });

    expect(submitCalonBooking.mock.calls[0][0].booking.requester).toEqual({ name: 'ACME', email: 'b@example.com' });
  });

  it('returns 409 with the field id and stores nothing when calon rejects the slot', async () => {
    seedForm(STEPS);
    submitCalonBooking.mockResolvedValue({ accepted: false, code: 'SLOT_TAKEN', message: 'Taken' });

    const res = await request(app).post('/api/public/form/booking-form/submit').send({ data: ANSWERS });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({ code: 'slot_unavailable', fieldId: 'when' }));
    expect(storedSubmissions()).toHaveLength(0);
  });

  it('returns 409 without asking calon when there is no email to book with', async () => {
    seedForm(STEPS);

    const res = await request(app).post('/api/public/form/booking-form/submit').send({ data: { ...ANSWERS, mail: '' } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('calon_invalid_input');
    expect(submitCalonBooking).not.toHaveBeenCalled();
    expect(storedSubmissions()).toHaveLength(0);
  });

  it('stores the submission and marks the booking pending when calon is unreachable', async () => {
    seedForm(STEPS);
    submitCalonBooking.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app).post('/api/public/form/booking-form/submit').send({ data: ANSWERS });

    expect(res.status).toBe(201);
    const [sub] = storedSubmissions();
    expect(sub.metadata.calonPending).toBe(true);
    expect(sub.metadata.calonBookings.when).toEqual(expect.objectContaining({ status: 'pending', attempts: 1 }));
  });

  it("asks calon for the resource's timezone when the answer carries none", async () => {
    seedForm(STEPS);
    fetchCalonAvailability.mockResolvedValue({ timezone: 'America/New_York', slots: [] });
    submitCalonBooking.mockResolvedValue({ accepted: true, bookingId: 'bk_3' });

    await request(app).post('/api/public/form/booking-form/submit').send({ data: { ...ANSWERS, when: '2026-09-02 09:30' } });

    expect(fetchCalonAvailability).toHaveBeenCalledWith(expect.objectContaining({ resourceSlug: 'consulting' }));
    expect(submitCalonBooking.mock.calls[0][0].booking.start).toBe('2026-09-02T09:30:00-04:00');
  });

  it('leaves forms without a calon-connected field alone', async () => {
    seedForm([{ id: 'when', type: 'date-timeslot', calon: { enabled: false } }, { id: 'mail', type: 'email' }]);

    const res = await request(app).post('/api/public/form/booking-form/submit').send({ data: { when: '2026-09-02 09:30', mail: 'a@b.co' } });

    expect(res.status).toBe(201);
    expect(submitCalonBooking).not.toHaveBeenCalled();
    expect(storedSubmissions()[0].metadata.calonBookings).toBeUndefined();
  });
});

describe('processDueCalonBookings', () => {
  beforeEach(() => submitCalonBooking.mockReset());

  function seedPending(entry) {
    const formId = seedForm(STEPS);
    const id = uuid();
    const metadata = { calonPending: true, calonBookings: { when: entry } };
    getDb().prepare('INSERT INTO submissions (id, form_id, data, metadata) VALUES (?, ?, ?, ?)')
      .run(id, formId, JSON.stringify(ANSWERS), JSON.stringify(metadata));
    return id;
  }
  const due = { status: 'pending', attempts: 1, nextAttemptAt: '2000-01-01T00:00:00.000Z' };

  it('books a due pending booking and clears the pending flag', async () => {
    seedPending(due);
    submitCalonBooking.mockResolvedValue({ accepted: true, bookingId: 'bk_9' });

    await processDueCalonBookings(getDb());

    const [sub] = storedSubmissions();
    expect(sub.metadata.calonBookings.when).toEqual({ status: 'booked', bookingId: 'bk_9' });
    expect(sub.metadata.calonPending).toBeUndefined();
  });

  it('does not touch a pending booking whose retry time has not come', async () => {
    seedPending({ ...due, nextAttemptAt: '2999-01-01T00:00:00.000Z' });

    await processDueCalonBookings(getDb());

    expect(submitCalonBooking).not.toHaveBeenCalled();
  });

  it('records a rejection on retry as final', async () => {
    seedPending(due);
    submitCalonBooking.mockResolvedValue({ accepted: false, code: 'SLOT_TAKEN', message: 'Taken' });

    await processDueCalonBookings(getDb());

    const [sub] = storedSubmissions();
    expect(sub.metadata.calonBookings.when).toEqual({ status: 'rejected', code: 'SLOT_TAKEN', message: 'Taken' });
    expect(sub.metadata.calonPending).toBeUndefined();
  });

  it('backs off on another failure, and gives up after the last retry', async () => {
    seedPending(due);
    submitCalonBooking.mockRejectedValue(new Error('down'));

    await processDueCalonBookings(getDb());
    let [sub] = storedSubmissions();
    expect(sub.metadata.calonBookings.when).toEqual(expect.objectContaining({ status: 'pending', attempts: 2 }));
    expect(sub.metadata.calonBookings.when.nextAttemptAt > new Date().toISOString()).toBe(true);

    getDb().exec('DELETE FROM submissions');
    getDb().exec('DELETE FROM forms');
    getDb().exec('DELETE FROM users');
    seedPending({ ...due, attempts: 5 });
    await processDueCalonBookings(getDb());
    [sub] = storedSubmissions();
    expect(sub.metadata.calonBookings.when.status).toBe('failed');
    expect(sub.metadata.calonPending).toBeUndefined();
  });
});
