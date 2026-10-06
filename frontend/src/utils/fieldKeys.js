// Stable, human-readable field keys — the editor side of ROADMAP OF-1.
//
// Every leaf field (a single step, each sub-field of a combined step, each
// custom sub-field of an Address field) has a `key` that is unique within the
// form. It follows the label while the operator hasn't edited it
// (`keyCustom` unset) and is what CSV columns, webhooks and the lodgely
// connector map on; the opaque `id` stays the internal identity answers are
// stored under. Conditions reference fields by key.
//
// The derivation mirrors backend/src/utils/fieldKeys.js — keep them in sync.

export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_LEN = 40;

const TYPE_KEYS = { email: 'email', phone: 'phone', website: 'website', address: 'address' };
const TRANSLIT = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', ø: 'oe', å: 'aa' };

export function slugifyKey(text) {
  let s = String(text == null ? '' : text).toLowerCase();
  s = s.replace(/[äöüßæøå]/g, c => TRANSLIT[c]);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) return '';
  if (!/^[a-z]/.test(s)) s = `f_${s}`;
  return s.slice(0, MAX_LEN).replace(/_+$/, '');
}

// What the operator types into the key input, normalised live: lower-case,
// anything else becomes "_" (a trailing "_" is kept so typing continues).
export function normalizeTypedKey(text) {
  let s = String(text || '').toLowerCase();
  s = s.replace(/[äöüßæøå]/g, c => TRANSLIT[c]);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '');
  return s.slice(0, MAX_LEN);
}

export function baseKey(field) {
  if (!field || typeof field !== 'object') return 'field';
  if (TYPE_KEYS[field.type]) return TYPE_KEYS[field.type];
  return slugifyKey(field.label) || slugifyKey(field.question) || slugifyKey(field.type) || 'field';
}

function uniqueKey(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX_LEN - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Leaf fields in document order (the objects themselves).
export function leafFields(steps) {
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

// Condition references are keys (a bare id from before 0.46 still resolves);
// answers are keyed by id.
export function fieldIdResolver(steps) {
  const byKey = new Map();
  for (const f of leafFields(steps)) {
    if (typeof f.key === 'string' && f.id && !byKey.has(f.key)) byKey.set(f.key, f.id);
  }
  return (ref) => (byKey.has(ref) ? byKey.get(ref) : ref);
}

// Keys used by more than one field — shown as a warning in the editor and
// refused by the server on save.
export function duplicateKeys(steps) {
  const seen = new Set();
  const dupes = new Set();
  for (const f of leafFields(steps)) {
    if (!f.key) continue;
    if (seen.has(f.key)) dupes.add(f.key);
    seen.add(f.key);
  }
  return dupes;
}

// Run after every change to `steps`: re-derives the keys that follow their
// label, keeps the ones the operator set (`keyCustom`), and rewrites every
// condition that referenced a renamed key. Returns a new steps array.
export function syncFieldKeys(prevSteps, nextSteps) {
  const steps = JSON.parse(JSON.stringify(nextSteps || []));
  const leaves = leafFields(steps);
  const taken = new Set();

  // Operator-set keys win; they are kept even when duplicated so the operator
  // sees (and fixes) the clash instead of having their input silently changed.
  for (const f of leaves) {
    if (f.keyCustom && typeof f.key === 'string' && KEY_RE.test(f.key)) taken.add(f.key);
  }
  for (const f of leaves) {
    if (f.keyCustom && typeof f.key === 'string' && KEY_RE.test(f.key)) continue;
    delete f.keyCustom;
    const base = baseKey(f);
    // Keep a still-fitting `base` / `base_N` so reordering or deleting a
    // neighbour doesn't rename this field.
    const fits = typeof f.key === 'string' && (f.key === base || new RegExp(`^${base}_\\d+$`).test(f.key));
    f.key = fits && !taken.has(f.key) ? f.key : uniqueKey(base, taken);
    taken.add(f.key);
  }

  // Rename map by field id, then rewrite condition references.
  const prevKeyById = new Map();
  for (const f of leafFields(prevSteps)) if (f.id && f.key) prevKeyById.set(f.id, f.key);
  const renames = new Map();
  for (const f of leaves) {
    const old = prevKeyById.get(f.id);
    if (old && old !== f.key && !renames.has(old)) renames.set(old, f.key);
  }
  if (renames.size) {
    const fix = (owner) => {
      if (owner && owner.condition && renames.has(owner.condition.field)) {
        owner.condition = { ...owner.condition, field: renames.get(owner.condition.field) };
      }
    };
    for (const step of steps) {
      fix(step);
      if (step && step.type === 'group' && Array.isArray(step.fields)) step.fields.forEach(fix);
    }
  }
  return steps;
}
