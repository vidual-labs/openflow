const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// bcrypt work factor for new hashes. bcryptjs is pure JS (~300 ms at 12 on a
// typical server core), so hashing and comparing always go through the async
// API, which yields to the event loop between rounds instead of freezing every
// other request for the duration. BCRYPT_ROUNDS lets an operator on very slow
// hardware dial it down (never below 10); the test suite uses 10.
function bcryptRounds(env = process.env) {
  const n = Number.parseInt(env.BCRYPT_ROUNDS, 10);
  if (!Number.isInteger(n)) return 12;
  return Math.min(Math.max(n, 10), 14);
}

function hashPassword(password) {
  return bcrypt.hash(password, bcryptRounds());
}

// Seeding happens before the server listens, where blocking is harmless.
function hashPasswordSync(password) {
  return bcrypt.hashSync(password, bcryptRounds());
}

// A real hash of a random secret at the current cost, compared against when the
// e-mail is unknown, so a login for a missing account takes as long as one for
// an existing account. Built once, lazily.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

// Verifies `password` against `hash` (or against a dummy hash when there is no
// account). `needsRehash` is set when the stored hash uses a lower cost than
// the current one, so the caller can upgrade it while the plaintext is at hand.
async function verifyPassword(password, hash) {
  if (!hash) {
    await bcrypt.compare(password, await dummyHash());
    return { ok: false, needsRehash: false };
  }
  let ok = false;
  try {
    ok = await bcrypt.compare(password, hash);
  } catch {
    ok = false;
  }
  let needsRehash = false;
  if (ok) {
    try { needsRehash = bcrypt.getRounds(hash) < bcryptRounds(); } catch { needsRehash = false; }
  }
  return { ok, needsRehash };
}

module.exports = { bcryptRounds, hashPassword, hashPasswordSync, verifyPassword };
