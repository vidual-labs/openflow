const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/openflow.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled Form',
      slug TEXT UNIQUE NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      end_screen TEXT NOT NULL DEFAULT '{}',
      theme TEXT NOT NULL DEFAULT '{}',
      gtm_id TEXT DEFAULT '',
      published INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id)
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id)
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id TEXT NOT NULL,
      event TEXT NOT NULL,
      session_id TEXT,
      step_index INTEGER,
      step_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id)
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_form ON analytics_events(form_id, event, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events(form_id, session_id);
  `);

  // Migrate: add role column if missing (existing DBs)
  try {
    db.prepare('SELECT role FROM users LIMIT 1').get();
  } catch {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    console.log('Migration: added role column to users');
  }

  // Seed admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@openflow.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existing) {
    const { v4: uuid } = require('uuid');
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(uuid(), adminEmail, hash);
    console.log(`Admin user created: ${adminEmail}`);
  } else {
    // Ensure admin has admin role
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ? AND (role IS NULL OR role != 'admin')").run(adminEmail);
  }
}

module.exports = { getDb, initDb };
