// Server-side mirror of the renderer's conditional-logic evaluation
// (frontend/src/components/FormRenderer.jsx, `questionSteps`). A step with a
// `condition` is hidden when the referenced answer exists and fails the
// rule; an unanswered reference keeps the step visible, exactly like the
// renderer. Keep the two in sync.
//
// `condition.field` names the referenced field by its stable key (a bare id
// from before 0.46 still resolves); answers are keyed by field id, so the
// reference goes through `fieldIdResolver` first.

const { fieldIdResolver } = require('./fieldKeys');

function isStepVisible(step, answers, resolve = (ref) => ref) {
  if (!step || !step.condition) return true;
  const { field, op, value } = step.condition;
  if (!field) return true;
  const ans = answers ? answers[resolve(field)] : undefined;
  if (ans === undefined || ans === null) return true;
  const ansStr = String(ans);
  switch (op) {
    case 'equals': return ansStr === value;
    case 'not_equals': return ansStr !== value;
    case 'contains': return ansStr.toLowerCase().includes(String(value || '').toLowerCase());
    case 'is_set': return ans !== '' && ans !== false;
    case 'is_not_set': return ans === '' || ans === false || ans === undefined;
    default: return true;
  }
}

function visibleSteps(steps, answers) {
  const resolve = fieldIdResolver(steps);
  return (steps || []).filter(step => isStepVisible(step, answers, resolve));
}

module.exports = { isStepVisible, visibleSteps };
