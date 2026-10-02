const { getDb } = require('./db');

// Per-account lockout after repeated failed logins, persisted in the DB so a
// restart doesn't hand an attacker a fresh budget, and keyed by the lower-cased
// e-mail whether or not that account exists (identical behaviour for both, so
// the lockout can't be used to discover accounts).
//
// Lock durations grow with every 5 consecutive failures — 1, 5, 15, then 60
// minutes — and the count resets after a successful login or 24 hours without
// a failure. At the cap that is ~120 guesses a day, against ~14,000 with the
// old 10-per-minute limit.
//
// A browser that has logged in to the account before (a valid remembered-
// device cookie, see models/sessions.js) is not held back by the lockout, so
// someone hammering an address can't lock its owner out of their usual
// browser.

const STEP = 5;
const LOCK_MINUTES = [1, 5, 15, 60];
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
// The owner is e-mailed once the lockout reaches this many failures (past
// ordinary typos), at most once a day.
const NOTIFY_AT = 10;

function key(email) {
  return String(email).trim().toLowerCase();
}

function lockMinutes(failures) {
  if (failures < STEP) return 0;
  const step = Math.floor(failures / STEP) - 1;
  return LOCK_MINUTES[Math.min(step, LOCK_MINUTES.length - 1)];
}

// { locked: false } or { locked: true, retryAfterSeconds }.
function lockStatus(email) {
  const row = getDb().prepare('SELECT locked_until FROM login_failures WHERE email = ?').get(key(email));
  const now = Date.now();
  if (!row || row.locked_until <= now) return { locked: false };
  return { locked: true, retryAfterSeconds: Math.ceil((row.locked_until - now) / 1000) };
}

// Records a failed attempt. Returns { failures, lockedMinutes, notify } where
// `notify` says the account owner should be told now.
function recordFailure(email) {
  const db = getDb();
  const k = key(email);
  const now = Date.now();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM login_failures WHERE email = ?').get(k);
    const fresh = !row || now - row.last_failure_at > RESET_AFTER_MS;
    const failures = fresh ? 1 : row.failures + 1;
    // Only the attempt that crosses a step starts a lock (later failures by a
    // remembered browser mustn't keep extending it).
    const minutes = failures % STEP === 0 ? lockMinutes(failures) : 0;
    const lockedUntil = minutes ? now + minutes * 60_000 : (fresh ? 0 : row.locked_until);
    const notifiedAt = fresh ? 0 : row.notified_at;
    const notify = failures >= NOTIFY_AT && minutes > 0 && now - notifiedAt > RESET_AFTER_MS;
    db.prepare(`
      INSERT INTO login_failures (email, failures, locked_until, last_failure_at, notified_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until,
        last_failure_at = excluded.last_failure_at, notified_at = excluded.notified_at
    `).run(k, failures, lockedUntil, now, notify ? now : notifiedAt);
    return { failures, lockedMinutes: minutes, notify };
  })();
}

function clearFailures(email) {
  getDb().prepare('DELETE FROM login_failures WHERE email = ?').run(key(email));
}

module.exports = { lockMinutes, lockStatus, recordFailure, clearFailures };
