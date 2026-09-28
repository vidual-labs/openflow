// Server-side mirror of the renderer's conditional-logic evaluation
// (frontend/src/components/FormRenderer.jsx, `questionSteps`). A step with a
// `condition` is hidden when the referenced answer exists and fails the
// rule; an unanswered reference keeps the step visible, exactly like the
// renderer. Keep the two in sync.

function isStepVisible(step, answers) {
  if (!step || !step.condition) return true;
  const { field, op, value } = step.condition;
  if (!field) return true;
  const ans = answers ? answers[field] : undefined;
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
  return (steps || []).filter(step => isStepVisible(step, answers));
}

module.exports = { isStepVisible, visibleSteps };
