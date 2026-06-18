// Expand combined "group" steps into their individual leaf fields.
// A group step has the shape { id, type: 'group', fields: [fieldA, fieldB] };
// every other step is itself a leaf field. Mirrors backend/src/utils/steps.js.
export function flattenFields(steps) {
  const out = [];
  for (const step of steps || []) {
    if (step && step.type === 'group' && Array.isArray(step.fields)) {
      for (const field of step.fields) out.push(field);
    } else if (step) {
      out.push(step);
    }
  }
  return out;
}
