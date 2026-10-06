// Stable, human-readable field keys (ROADMAP OF-1).
//
// Every leaf field of a form — a single step, each sub-field of a combined
// "group" step and each custom sub-field of an Address field — carries a
// `key` matching KEY_RE that is unique within the form. Keys are what the
// outside world maps on (CSV columns, the lodgely connector, the submission
// contract v1); the opaque `id` (`field_<timestamp>`) stays the internal
// identity that submission `data` is keyed by.
//
// The editor derives a key from the label while the operator hasn't edited
// it, and mirrors the derivation in frontend/src/utils/fieldKeys.js. Keep the
// two in sync: a form saved by an older editor (no keys at all) gets them
// filled in here, and the result should match what the editor would show.

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_LEN = 40;

// Contact-type fields default to their type's name so a lodgely mapping can
// find "the email field" on any form without reading labels.
const TYPE_KEYS = { email: 'email', phone: 'phone', website: 'website', address: 'address' };

const TRANSLIT = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', ø: 'oe', å: 'aa' };

function slugifyKey(text) {
  let s = String(text == null ? '' : text).toLowerCase();
  s = s.replace(/[äöüßæøå]/g, c => TRANSLIT[c]);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) return '';
  if (!/^[a-z]/.test(s)) s = `f_${s}`;
  return s.slice(0, MAX_LEN).replace(/_+$/, '');
}

// The key a field would get with nothing taken yet.
function baseKey(field) {
  if (!field || typeof field !== 'object') return 'field';
  if (TYPE_KEYS[field.type]) return TYPE_KEYS[field.type];
  return slugifyKey(field.label) || slugifyKey(field.question) || slugifyKey(field.type) || 'field';
}

// `base`, else `base_2`, `base_3`, … — the suffix always fits into MAX_LEN.
function uniqueKey(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX_LEN - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Leaf fields in document order: steps, group sub-fields, address custom
// sub-fields. Returns the objects themselves (not copies).
function leafFields(steps) {
  const out = [];
  const collect = (f) => {
    if (!f || typeof f !== 'object') return;
    out.push(f);
    if (f.type === 'address' && Array.isArray(f.customFields)) {
      for (const c of f.customFields) if (c && typeof c === 'object') out.push(c);
    }
  };
  for (const step of steps || []) {
    if (step && step.type === 'group' && Array.isArray(step.fields)) {
      for (const f of step.fields) collect(f);
    } else {
      collect(step);
    }
  }
  return out;
}

// Strict check for the API: a key that is present must be well-formed and
// unique. Missing keys are fine (ensureFieldKeys fills them). Returns an
// error message naming the offending key, or null.
function validateFieldKeys(steps) {
  const seen = new Set();
  for (const f of leafFields(steps)) {
    if (f.key === undefined || f.key === null || f.key === '') continue;
    if (typeof f.key !== 'string' || !KEY_RE.test(f.key)) {
      return `Field key "${String(f.key)}" is invalid: use 1–40 lower-case letters, digits or underscores, starting with a letter`;
    }
    if (seen.has(f.key)) return `Field key "${f.key}" is used by more than one field`;
    seen.add(f.key);
  }
  return null;
}

// Returns a deep copy of `steps` in which every leaf field has a unique key.
// Existing well-formed keys are kept (first occurrence wins); everything
// else is derived from the label / type.
function ensureFieldKeys(steps) {
  const out = JSON.parse(JSON.stringify(steps || []));
  const leaves = leafFields(out);
  const taken = new Set();
  const keep = new Set();
  for (const f of leaves) {
    if (typeof f.key === 'string' && KEY_RE.test(f.key) && !taken.has(f.key)) {
      taken.add(f.key);
      keep.add(f);
    }
  }
  for (const f of leaves) {
    if (keep.has(f)) continue;
    f.key = uniqueKey(baseKey(f), taken);
    taken.add(f.key);
  }
  return out;
}

// Maps a condition's `field` reference to the field id the answer is stored
// under. References are keys since 0.46; a bare id (older editors, forms
// not yet migrated) still resolves. Unknown references pass through, which
// every evaluator treats as "no answer yet → step stays visible".
function fieldIdResolver(steps) {
  const byKey = new Map();
  for (const f of leafFields(steps)) {
    if (typeof f.key === 'string' && f.id && !byKey.has(f.key)) byKey.set(f.key, f.id);
  }
  return (ref) => (byKey.has(ref) ? byKey.get(ref) : ref);
}

// Rewrites condition references from ids to keys. With `strict`, a reference
// that is neither a key nor an id of a field in the form is an error (the
// editor drops such conditions itself; an API client gets a 400 naming it).
// Without it (boot migration) dangling references are left alone.
function normalizeConditions(steps, { strict = false } = {}) {
  const keyOf = new Map(); // id → key
  const keys = new Set();
  for (const f of leafFields(steps)) {
    if (typeof f.key !== 'string') continue;
    keys.add(f.key);
    if (f.id && !keyOf.has(f.id)) keyOf.set(f.id, f.key);
  }
  const fix = (owner) => {
    const c = owner && owner.condition;
    if (!c || typeof c !== 'object' || !c.field) return null;
    if (keys.has(c.field)) return null;
    if (keyOf.has(c.field)) { c.field = keyOf.get(c.field); return null; }
    if (!strict) return null;
    const name = owner.label || owner.question || (owner.fields || []).map(f => f.label || f.question).filter(Boolean).join(' + ') || owner.id;
    return `The condition on "${name}" refers to a field key "${c.field}" that no longer exists`;
  };
  for (const step of steps || []) {
    const err = fix(step);
    if (err) return err;
    if (step && step.type === 'group' && Array.isArray(step.fields)) {
      for (const f of step.fields) {
        const e = fix(f);
        if (e) return e;
      }
    }
  }
  return null;
}

// The whole save-path treatment: validate present keys, fill missing ones,
// point conditions at keys. Returns { steps } or { error }.
function prepareSteps(steps, { strict = true } = {}) {
  if (strict) {
    const err = validateFieldKeys(steps);
    if (err) return { error: err };
  }
  const prepared = ensureFieldKeys(steps);
  const condErr = normalizeConditions(prepared, { strict });
  if (condErr) return { error: condErr };
  return { steps: prepared };
}

module.exports = {
  KEY_RE,
  TYPE_KEYS,
  slugifyKey,
  baseKey,
  uniqueKey,
  leafFields,
  validateFieldKeys,
  ensureFieldKeys,
  fieldIdResolver,
  normalizeConditions,
  prepareSteps,
};
