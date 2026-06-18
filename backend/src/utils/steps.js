// Helpers for working with a form's `steps` array.
//
// A step is normally a single field. Two adjacent questions can be combined
// into one screen ("step") in the editor; such a step has the shape
//   { id, type: 'group', fields: [ fieldA, fieldB ] }
// where each entry in `fields` is an ordinary field keeping its own id. Every
// downstream consumer (validation, CSV export, integrations, ...) cares about
// the individual leaf fields, so it flattens groups first via this helper.

function flattenFields(steps) {
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

module.exports = { flattenFields };
