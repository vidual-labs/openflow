const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { createTestApp } = require('./setup');

function getDb() {
  return require('../src/models/db').getDb();
}

function seedUsers() {
  const db = getDb();
  const adminId = uuid();
  const userId = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(adminId, 'admin@test.com', bcrypt.hashSync('adminpass', 10), 'admin');
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, 'user@test.com', bcrypt.hashSync('userpass', 10), 'user');
  return { adminId, userId };
}

async function login(app, email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.headers['set-cookie'];
}

describe('Admin backup & restore', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('authorization', () => {
    it('rejects unauthenticated backup download', async () => {
      const res = await request(app).get('/api/admin/backup');
      expect(res.status).toBe(401);
    });

    it('rejects non-admin users', async () => {
      seedUsers();
      const cookie = await login(app, 'user@test.com', 'userpass');
      const res = await request(app).get('/api/admin/backup').set('Cookie', cookie);
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated restore', async () => {
      const res = await request(app).post('/api/admin/restore').send({ openflow_backup: true, tables: {} });
      expect(res.status).toBe(401);
    });
  });

  describe('backup', () => {
    it('returns a downloadable backup with all data', async () => {
      const { adminId } = seedUsers();
      const db = getDb();
      const formId = uuid();
      db.prepare('INSERT INTO forms (id, user_id, title, slug) VALUES (?, ?, ?, ?)')
        .run(formId, adminId, 'My Form', 'my-form');
      db.prepare('INSERT INTO submissions (id, form_id, data) VALUES (?, ?, ?)')
        .run(uuid(), formId, JSON.stringify({ name: 'Ada' }));

      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const res = await request(app).get('/api/admin/backup').set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/openflow-backup-.*\.json/);
      const backup = JSON.parse(res.text);
      expect(backup.openflow_backup).toBe(true);
      expect(backup.version).toBe(1);
      expect(backup.tables.users).toHaveLength(2);
      expect(backup.tables.forms).toHaveLength(1);
      expect(backup.tables.submissions[0].data).toContain('Ada');
    });

    it('reports a summary via /backup/info', async () => {
      seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const res = await request(app).get('/api/admin/backup/info').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(1);
      expect(res.body.counts.users).toBe(2);
    });
  });

  describe('restore', () => {
    it('replaces the database contents from a backup', async () => {
      const { adminId } = seedUsers();
      const db = getDb();
      const formId = uuid();
      db.prepare('INSERT INTO forms (id, user_id, title, slug) VALUES (?, ?, ?, ?)')
        .run(formId, adminId, 'Original', 'original');

      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const backupRes = await request(app).get('/api/admin/backup').set('Cookie', cookie);
      const backup = JSON.parse(backupRes.text);

      // Mutate the live DB after taking the backup.
      db.prepare('UPDATE forms SET title = ? WHERE id = ?').run('Changed', formId);
      db.prepare('INSERT INTO forms (id, user_id, title, slug) VALUES (?, ?, ?, ?)')
        .run(uuid(), adminId, 'Extra', 'extra');

      const restoreRes = await request(app).post('/api/admin/restore').set('Cookie', cookie).send(backup);
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.ok).toBe(true);

      const forms = db.prepare('SELECT title FROM forms').all();
      expect(forms).toHaveLength(1);
      expect(forms[0].title).toBe('Original');
    });

    it('preserves the acting admin even when the backup omits them', async () => {
      seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');

      // A backup that contains a totally different set of users.
      const otherAdminId = uuid();
      const backup = {
        openflow_backup: true,
        version: 1,
        tables: {
          users: [
            { id: otherAdminId, email: 'someone@else.com', password_hash: bcrypt.hashSync('x', 10), role: 'admin' },
          ],
        },
      };

      const res = await request(app).post('/api/admin/restore').set('Cookie', cookie).send(backup);
      expect(res.status).toBe(200);
      expect(res.body.adminPreserved).toBe(true);

      const db = getDb();
      const me = db.prepare("SELECT role FROM users WHERE email = 'admin@test.com'").get();
      expect(me).toBeDefined();
      expect(me.role).toBe('admin');

      // The acting admin can still log in with their original credentials.
      const relogin = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'adminpass' });
      expect(relogin.status).toBe(200);
    });

    it('does not duplicate the admin when the backup already contains them', async () => {
      seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const backupRes = await request(app).get('/api/admin/backup').set('Cookie', cookie);
      const backup = JSON.parse(backupRes.text);

      const res = await request(app).post('/api/admin/restore').set('Cookie', cookie).send(backup);
      expect(res.status).toBe(200);

      const db = getDb();
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'admin@test.com'").get();
      expect(admins.n).toBe(1);
    });

    it('reassigns forms to the acting admin when the backup used a different user id', async () => {
      // Simulate restoring to a fresh deployment: the admin signs up with the
      // same email but gets a new UUID. The backup contains forms owned by the
      // old UUID. After restore those forms must be visible to the new admin.
      const { adminId } = seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const db = getDb();

      const oldAdminId = uuid(); // id the admin had in the source deployment
      const formId = uuid();
      const backup = {
        openflow_backup: true,
        version: 1,
        tables: {
          users: [
            { id: oldAdminId, email: 'admin@test.com', password_hash: bcrypt.hashSync('adminpass', 10), role: 'admin' },
          ],
          forms: [
            { id: formId, user_id: oldAdminId, title: 'Migrated Form', slug: 'migrated-form', published: 0, theme: '{}', integrations: '{}', fields: '[]' },
          ],
        },
      };

      const res = await request(app).post('/api/admin/restore').set('Cookie', cookie).send(backup);
      expect(res.status).toBe(200);

      // The form must now be owned by the acting admin's current id.
      const form = db.prepare('SELECT user_id FROM forms WHERE id = ?').get(formId);
      expect(form).toBeDefined();
      expect(form.user_id).toBe(adminId);
    });

    it('rejects a non-OpenFlow file', async () => {
      seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const res = await request(app).post('/api/admin/restore').set('Cookie', cookie).send({ hello: 'world' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not an OpenFlow backup/);
    });

    it('rejects a backup from a newer format version', async () => {
      seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const res = await request(app)
        .post('/api/admin/restore')
        .set('Cookie', cookie)
        .send({ openflow_backup: true, version: 999, tables: {} });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/newer version/);
    });

    it('migrates a legacy (versionless) backup by filling defaults', async () => {
      seedUsers();
      const cookie = await login(app, 'admin@test.com', 'adminpass');
      const legacy = {
        openflow_backup: true,
        tables: {
          users: [
            { id: uuid(), email: 'legacy@test.com', password_hash: bcrypt.hashSync('x', 10) },
          ],
        },
      };
      const res = await request(app).post('/api/admin/restore').set('Cookie', cookie).send(legacy);
      expect(res.status).toBe(200);

      const db = getDb();
      const restored = db.prepare("SELECT role FROM users WHERE email = 'legacy@test.com'").get();
      expect(restored.role).toBe('user');
    });
  });
});
