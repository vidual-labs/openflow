import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import IntegrationsPanel from '../components/IntegrationsPanel';
import '../components/FormRenderer.css';

// Field types sorted logically: question types first, then contact/data fields
const FIELD_TYPES = [
  // --- Question Types ---
  { value: 'text', label: 'Short Text', icon: '📝', defaults: { question: 'What is your answer?', label: 'Answer', placeholder: 'Type your answer...' } },
  { value: 'textarea', label: 'Long Text', icon: '📄', defaults: { question: 'Tell us more...', label: 'Details', placeholder: 'Type your answer...' } },
  { value: 'number', label: 'Number', icon: '🔢', defaults: { question: 'Enter a number', label: 'Number', placeholder: '0' } },
  { value: 'date', label: 'Date', icon: '📅', defaults: { question: 'Pick a date', label: 'Date', placeholder: '' } },
  { value: 'select', label: 'Single Choice', icon: '☑️', defaults: { question: 'Choose one option', label: 'Choice', placeholder: '', options: ['Option 1', 'Option 2', 'Option 3'] } },
  { value: 'multi-select', label: 'Multiple Choice', icon: '✅', defaults: { question: 'Choose one or more options', label: 'Selection', placeholder: '', options: ['Option 1', 'Option 2', 'Option 3'] } },
  { value: 'yes-no', label: 'Yes / No', icon: '👍', defaults: { question: 'Is this correct?', label: 'Confirmation', placeholder: '' } },
  { value: 'rating', label: 'Rating', icon: '⭐', defaults: { question: 'How would you rate this?', label: 'Rating', placeholder: '' } },
  { value: 'image-select', label: 'Image / Icon Select', icon: '🖼️', defaults: { question: 'Choose an option', label: 'Selection', placeholder: '', options: [{ value: 'opt1', label: 'Option 1', icon: '🏠' }, { value: 'opt2', label: 'Option 2', icon: '🏢' }, { value: 'opt3', label: 'Option 3', icon: '🏗️' }] } },
  { value: 'file-upload', label: 'File Upload', icon: '📎', defaults: { question: 'Upload a file', label: 'File', placeholder: '', accept: '.pdf,.jpg,.png,.doc,.docx', maxSizeMB: 10 } },
  // --- Contact & Data Fields ---
  { value: 'email', label: 'Email Address', icon: '📧', defaults: { question: 'What is your email address?', label: 'Email', placeholder: 'name@example.com' } },
  { value: 'phone', label: 'Phone Number', icon: '📞', defaults: { question: 'What is your phone number?', label: 'Phone', placeholder: '+1 234 567890' } },
  { value: 'website', label: 'Website URL', icon: '🌐', defaults: { question: 'What is your website?', label: 'Website', placeholder: 'https://example.com' } },
  { value: 'address', label: 'Address', icon: '🏠', defaults: { question: 'What is your address?', label: 'Address', placeholder: '' } },
];

const FIELD_TYPE_MAP = Object.fromEntries(FIELD_TYPES.map(f => [f.value, f]));

// Lighten a hex color by amount (0-255) — mirrors the same helper in FormRenderer
function adjustColor(hex, amount) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0x00ff) + amount);
  const b = Math.min(255, (num & 0x0000ff) + amount);
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

const BG_SHAPE_COUNTS = { waves: 3, bubbles: 4, aurora: 3, particles: 6, flow: 4 };

// Common emoji categories for the icon picker
const EMOJI_CATEGORIES = {
  'Popular': ['👍', '👎', '❤️', '⭐', '🔥', '✅', '❌', '💡', '🎯', '🚀', '💰', '📦', '🏆', '🎉', '💎', '⚡'],
  'Buildings': ['🏠', '🏢', '🏗️', '🏭', '🏥', '🏫', '🏛️', '⛪', '🏪', '🏨', '🏰', '🏟️'],
  'Transport': ['🚗', '🚕', '🚌', '🏎️', '🚓', '🚲', '✈️', '🚀', '🛳️', '🚁', '🚂', '🏍️'],
  'Nature': ['🌳', '🌺', '🌻', '🌿', '☀️', '🌙', '⭐', '🌊', '🏔️', '🌈', '🍃', '🔥'],
  'Food': ['🍕', '🍔', '🍣', '☕', '🍷', '🎂', '🍎', '🥗', '🍜', '🧁', '🍺', '🥤'],
  'People': ['👤', '👥', '👨‍💻', '👩‍💼', '👨‍🔧', '👩‍⚕️', '👨‍🏫', '👩‍🍳', '🤝', '👋', '💪', '🙌'],
  'Objects': ['💻', '📱', '📧', '📞', '🔑', '🔒', '📊', '📈', '💳', '🛒', '📋', '✏️'],
  'Symbols': ['✓', '✗', '➡️', '⬅️', '⬆️', '⬇️', '♻️', '💲', '📌', '🔗', '⚙️', '🔔'],
};

export default function FormEditor() {
  const { id } = useParams();
  const [form, setForm] = useState(null);
  const [primaryHost, setPrimaryHost] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [activeTab, setActiveTab] = useState('steps');
  const [expandedStep, setExpandedStep] = useState(null);

  useEffect(() => {
    // Fetch site config once so we know whether subdomain hosting is configured.
    api.getSettings().then(d => setPrimaryHost(d.primaryHost || null)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoadError('');
    api.getForm(id)
      .then(d => setForm(d.form))
      .catch(err => setLoadError(err.message || 'Failed to load form'));
  }, [id]);

  if (loadError) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#E17055' }}>
      <p>{loadError}</p>
    </div>
  );
  if (!form) return <div>Loading...</div>;

  async function save(updates = {}) {
    setSaving(true);
    setSaved(false);
    setSaveError('');
    const payload = {
      title: form.title,
      steps: form.steps,
      end_screen: form.end_screen,
      theme: form.theme,
      gtm_id: form.gtm_id,
      published: form.published,
      ...updates,
    };
    try {
      const { form: updated } = await api.updateForm(id, payload);
      setForm(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function updateStep(index, changes) {
    const steps = [...form.steps];
    steps[index] = { ...steps[index], ...changes };
    setForm({ ...form, steps });
  }

  function changeFieldType(index, newType) {
    const fieldDef = FIELD_TYPE_MAP[newType];
    const step = form.steps[index];
    const defaults = fieldDef?.defaults || {};
    const steps = [...form.steps];
    // Keep existing id, update everything else with smart defaults
    steps[index] = {
      id: step.id,
      type: newType,
      question: defaults.question || '',
      label: defaults.label || '',
      placeholder: defaults.placeholder || '',
      required: step.required || false,
      // Type-specific defaults
      ...(defaults.options ? { options: defaults.options } : {}),
      ...(defaults.consentText ? { consentText: defaults.consentText } : {}),
    };
    setForm({ ...form, steps });
  }

  function addStep() {
    const newId = `field_${Date.now()}`;
    const defaultType = FIELD_TYPES[0];
    const steps = [...form.steps, {
      id: newId,
      type: defaultType.value,
      question: defaultType.defaults.question,
      label: defaultType.defaults.label,
      required: false,
      placeholder: defaultType.defaults.placeholder,
    }];
    setForm({ ...form, steps });
    setExpandedStep(steps.length - 1);
  }

  function removeStep(index) {
    const steps = form.steps.filter((_, i) => i !== index);
    setForm({ ...form, steps });
    if (expandedStep === index) setExpandedStep(null);
    else if (expandedStep > index) setExpandedStep(expandedStep - 1);
  }

  function moveStep(index, dir) {
    const steps = [...form.steps];
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setForm({ ...form, steps });
    if (expandedStep === index) setExpandedStep(target);
    else if (expandedStep === target) setExpandedStep(index);
  }

  // Merge an adjacent pair of single questions into one combined "group" step
  // (max two questions per step). dir = -1 combines with the question above,
  // dir = +1 with the one below. Reversible via splitGroup.
  function combineSteps(index, dir) {
    const topIndex = dir === -1 ? index - 1 : index;
    const a = form.steps[topIndex];
    const b = form.steps[topIndex + 1];
    if (!a || !b || a.type === 'group' || b.type === 'group') return;
    const group = { id: `group_${Date.now()}`, type: 'group', fields: [a, b] };
    // Lift a sub-field condition up to the group so visibility logic still
    // applies while combined; the original is preserved for a lossless split.
    if (a.condition || b.condition) group.condition = a.condition || b.condition;
    const steps = [...form.steps];
    steps.splice(topIndex, 2, group);
    setForm({ ...form, steps });
    setExpandedStep(topIndex);
  }

  // Split a combined step back into its two separate questions.
  function splitGroup(index) {
    const group = form.steps[index];
    if (!group || group.type !== 'group') return;
    const steps = [...form.steps];
    steps.splice(index, 1, ...(group.fields || []));
    setForm({ ...form, steps });
    setExpandedStep(index);
  }

  const baseUrl = window.location.origin;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Link to="/" className="back-link">&larr; Back</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              style={{ fontSize: 24, fontWeight: 700, border: 'none', background: 'none', padding: 0, outline: 'none', flex: 1, minWidth: 0, maxWidth: 480, color: 'var(--text)' }}
            />
            <span className={`badge ${form.published ? 'badge-published' : 'badge-draft'}`}>
              {form.published ? 'Live' : 'Draft'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>Saved!</span>}
          {saveError && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{saveError}</span>}
          {form.published ? (
            <a
              href={`${baseUrl}/embed/${form.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ textDecoration: 'none' }}
            >
              Open Preview &#8599;
            </a>
          ) : null}
          <button className="btn btn-secondary" onClick={() => save({ published: form.published ? 0 : 1 })}>
            {form.published ? 'Unpublish' : 'Publish'}
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        {[{ key: 'steps', label: 'Questions' }, { key: 'endscreen', label: 'End Screen' }, { key: 'theme', label: 'Design' }, { key: 'tracking', label: 'GTM / GDPR' }, { key: 'integrations', label: 'Integrations' }, { key: 'embed', label: 'Embed' }].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: activeTab === tab.key ? 'var(--primary)' : 'transparent',
              color: activeTab === tab.key ? 'white' : 'var(--text-light)',
              borderRadius: '8px 8px 0 0',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Steps Tab */}
      {activeTab === 'steps' && (
        <div>
          {form.steps.map((step, i) => (
            <StepEditor
              key={step.id}
              step={step}
              index={i}
              total={form.steps.length}
              allSteps={form.steps}
              expanded={expandedStep === i}
              onToggle={() => setExpandedStep(expandedStep === i ? null : i)}
              onChange={(changes) => updateStep(i, changes)}
              onChangeType={(type) => changeFieldType(i, type)}
              onMove={(dir) => moveStep(i, dir)}
              onCombine={(dir) => combineSteps(i, dir)}
              onSplit={() => splitGroup(i)}
              onRemove={() => removeStep(i)}
            />
          ))}

          <button className="btn btn-secondary" onClick={addStep} style={{ width: '100%', justifyContent: 'center', padding: 16 }}>
            + Add Question
          </button>
        </div>
      )}

      {/* End Screen Tab */}
      {activeTab === 'endscreen' && (
        <div className="card">
          <div className="input-group">
            <label>Title</label>
            <input className="input" value={form.end_screen?.title || ''} onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, title: e.target.value } })} />
          </div>
          <div className="input-group">
            <label>Message</label>
            <textarea className="input" rows={3} value={form.end_screen?.message || ''} onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, message: e.target.value } })} />
          </div>
          <div className="input-group">
            <label>Redirect URL (optional)</label>
            <input className="input" value={form.end_screen?.redirectUrl || ''} onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, redirectUrl: e.target.value } })} placeholder="https://..." />
          </div>
          {form.end_screen?.redirectUrl && (
            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!form.end_screen?.autoRedirect}
                  onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, autoRedirect: e.target.checked } })}
                />
                Automatically open this URL when the form is submitted
              </label>
              <span style={{ fontSize: 11, color: '#999', marginTop: 4, display: 'block' }}>Opens in the top-level window, escaping the iframe if OpenFlow is embedded.</span>
            </div>
          )}
        </div>
      )}

      {/* Theme Tab */}
      {activeTab === 'theme' && (
        <div>
          {/* Live Preview */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>👁️</span>
              <div>
                <h3 style={{ margin: 0 }}>Live Preview</h3>
                <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Reflects unsaved changes — click <strong>Save</strong> to publish.</p>
              </div>
            </div>
            <ThemePreview theme={form.theme || {}} />
          </div>

          {/* Colors */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>🎨</span>
              <div>
                <h3 style={{ margin: 0 }}>Colors</h3>
                <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Define the look and feel of your form.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
              <div className="input-group">
                <label>Primary Color</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="color" value={form.theme?.primaryColor || '#6C5CE7'} onChange={e => setForm({ ...form, theme: { ...form.theme, primaryColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer', borderRadius: 8 }} />
                  <input className="input" value={form.theme?.primaryColor || '#6C5CE7'} onChange={e => setForm({ ...form, theme: { ...form.theme, primaryColor: e.target.value } })} />
                </div>
              </div>
              <div className="input-group">
                <label>Accent Color</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="color" value={form.theme?.accentColor || ''} onChange={e => setForm({ ...form, theme: { ...form.theme, accentColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer', borderRadius: 8 }} />
                  <input className="input" value={form.theme?.accentColor || ''} onChange={e => setForm({ ...form, theme: { ...form.theme, accentColor: e.target.value } })} placeholder="Auto" />
                </div>
                <span style={{ fontSize: 11, color: '#999', marginTop: 4, display: 'block' }}>Used for animated backgrounds. Auto-derived if empty.</span>
              </div>
              <div className="input-group">
                <label>Background Color</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="color" value={form.theme?.backgroundColor || '#FFFFFF'} onChange={e => setForm({ ...form, theme: { ...form.theme, backgroundColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer', borderRadius: 8 }} />
                  <input className="input" value={form.theme?.backgroundColor || '#FFFFFF'} onChange={e => setForm({ ...form, theme: { ...form.theme, backgroundColor: e.target.value } })} />
                </div>
              </div>
              <div className="input-group">
                <label>Text Color</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="color" value={form.theme?.textColor || '#2D3436'} onChange={e => setForm({ ...form, theme: { ...form.theme, textColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer', borderRadius: 8 }} />
                  <input className="input" value={form.theme?.textColor || '#2D3436'} onChange={e => setForm({ ...form, theme: { ...form.theme, textColor: e.target.value } })} />
                </div>
              </div>
            </div>
          </div>

          {/* Animated Background */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>✨</span>
              <div>
                <h3 style={{ margin: 0 }}>Animated Background</h3>
                <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Add subtle motion to make your form feel alive. Uses primary + accent colors.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
              {[
                { value: 'none', label: 'None', preview: '⊘' },
                { value: 'waves', label: 'Waves', preview: '🌊' },
                { value: 'bubbles', label: 'Bubbles', preview: '🫧' },
                { value: 'aurora', label: 'Aurora', preview: '🌌' },
                { value: 'particles', label: 'Particles', preview: '✦' },
                { value: 'flow', label: 'Flow', preview: '≋' },
              ].map(bg => (
                <button
                  key={bg.value}
                  onClick={() => setForm({ ...form, theme: { ...form.theme, backgroundAnimation: bg.value } })}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '16px 12px',
                    border: (form.theme?.backgroundAnimation || 'none') === bg.value ? '2px solid var(--primary, #6C5CE7)' : '2px solid var(--border, #e0e0e0)',
                    borderRadius: 12,
                    background: (form.theme?.backgroundAnimation || 'none') === bg.value ? 'rgba(108,92,231,0.08)' : 'var(--card, #fafafa)',
                    cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    color: (form.theme?.backgroundAnimation || 'none') === bg.value ? 'var(--primary, #6C5CE7)' : 'var(--text, #333)',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 28 }}>{bg.preview}</span>
                  {bg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Button & Navigation */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>🧭</span>
              <div>
                <h3 style={{ margin: 0 }}>Button & Navigation</h3>
                <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Control the position of the "Next" button and keyboard hints.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="input-group">
                <label>Form Language</label>
                <select
                  className="input"
                  value={form.theme?.language || 'en'}
                  onChange={e => setForm({ ...form, theme: { ...form.theme, language: e.target.value } })}
                >
                  <option value="en">English</option>
                  <option value="de">Deutsch (German)</option>
                </select>
                <span style={{ fontSize: 11, color: '#999', marginTop: 4, display: 'block' }}>Sets the language for all built-in UI text shown to respondents.</span>
              </div>
              <div className="input-group">
                <label>Button Position</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { value: 'footer', label: 'Footer Bar', desc: 'Fixed navigation bar at the bottom' },
                    { value: 'inline', label: 'Below Input', desc: 'Button below question & input' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setForm({ ...form, theme: { ...form.theme, buttonPosition: opt.value } })}
                      style={{
                        flex: 1, padding: '12px 14px', textAlign: 'left',
                        border: (form.theme?.buttonPosition || 'footer') === opt.value ? '2px solid var(--primary, #6C5CE7)' : '2px solid var(--border, #e0e0e0)',
                        borderRadius: 10,
                        background: (form.theme?.buttonPosition || 'footer') === opt.value ? 'rgba(108,92,231,0.08)' : 'var(--card, #fafafa)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14, color: (form.theme?.buttonPosition || 'footer') === opt.value ? 'var(--primary, #6C5CE7)' : 'var(--text, #333)' }}>
                        {opt.label}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-light, #999)', marginTop: 2 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="input-group">
                <label>Enter Key Hint</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, cursor: 'pointer', marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!form.theme?.showEnterHint}
                    onChange={e => setForm({ ...form, theme: { ...form.theme, showEnterHint: e.target.checked } })}
                    style={{ width: 20, height: 20, accentColor: 'var(--primary)' }}
                  />
                  Show "press Enter" hint next to button
                </label>
                <span style={{ fontSize: 11, color: '#999', marginTop: 8, display: 'block' }}>
                  Displays a subtle keyboard shortcut hint (press Enter &#8629;) next to the Next button.
                </span>
              </div>
              <div className="input-group">
                <label>Auto-Advance</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, cursor: 'pointer', marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={!form.theme?.disableAutoAdvance}
                    onChange={e => setForm({ ...form, theme: { ...form.theme, disableAutoAdvance: !e.target.checked } })}
                    style={{ width: 20, height: 20, accentColor: 'var(--primary)' }}
                  />
                  Automatically advance when answer is selected
                </label>
                <span style={{ fontSize: 11, color: '#999', marginTop: 8, display: 'block' }}>
                  Auto-advance only works for choice-based fields (single choice, multiple choice, yes/no, rating, image select).
                </span>
              </div>
              <div className="input-group">
                <label>Next Button Label</label>
                <input
                  className="input"
                  value={form.theme?.nextButtonLabel || ''}
                  onChange={e => setForm({ ...form, theme: { ...form.theme, nextButtonLabel: e.target.value } })}
                  placeholder="Next"
                />
                <span style={{ fontSize: 11, color: '#999', marginTop: 4, display: 'block' }}>Leave blank to use the default "Next →"</span>
              </div>
              <div className="input-group">
                <label>Submit Button Label</label>
                <input
                  className="input"
                  value={form.theme?.submitButtonLabel || ''}
                  onChange={e => setForm({ ...form, theme: { ...form.theme, submitButtonLabel: e.target.value } })}
                  placeholder="Submit"
                />
                <span style={{ fontSize: 11, color: '#999', marginTop: 4, display: 'block' }}>Leave blank to use the default "Submit →"</span>
              </div>
            </div>
          </div>

          {/* Font */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>🔤</span>
              <div>
                <h3 style={{ margin: 0 }}>Typography</h3>
                <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Choose a font family for your form.</p>
              </div>
            </div>
            <div className="input-group">
              <label>Font Family</label>
              <select className="input" value={form.theme?.fontFamily || 'inherit'} onChange={e => setForm({ ...form, theme: { ...form.theme, fontFamily: e.target.value } })} style={{ maxWidth: 320 }}>
                <option value="inherit">System Default</option>
                <option value="'Inter', sans-serif">Inter</option>
                <option value="'Space Grotesk', sans-serif">Space Grotesk</option>
                <option value="'DM Sans', sans-serif">DM Sans</option>
                <option value="'Plus Jakarta Sans', sans-serif">Plus Jakarta Sans</option>
                <option value="Georgia, serif">Georgia (Serif)</option>
                <option value="'Courier New', monospace">Courier New (Mono)</option>
              </select>
            </div>
          </div>

          {/* Header / Landing Page */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>🏷️</span>
              <div>
                <h3 style={{ margin: 0 }}>Header / Landing Page</h3>
                <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Add a logo and tagline to make your form a standalone landing page.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="input-group">
                <label>Logo URL</label>
                <input className="input" value={form.theme?.logoUrl || ''} onChange={e => setForm({ ...form, theme: { ...form.theme, logoUrl: e.target.value } })} placeholder="https://example.com/logo.png" />
                <span style={{ fontSize: 11, color: '#999', marginTop: 4, display: 'block' }}>Recommended: max height 48px, PNG/SVG with transparent background</span>
              </div>
              <div className="input-group">
                <label>Logo Position</label>
                <select className="input" value={form.theme?.logoPosition || 'center'} onChange={e => setForm({ ...form, theme: { ...form.theme, logoPosition: e.target.value } })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                </select>
              </div>
            </div>
            <div className="input-group">
              <label>Headline</label>
              <input className="input" value={form.theme?.headline || ''} onChange={e => setForm({ ...form, theme: { ...form.theme, headline: e.target.value } })} placeholder="e.g. Get your free quote in 2 minutes" />
            </div>
            <div className="input-group">
              <label>Subline (optional)</label>
              <input className="input" value={form.theme?.subline || ''} onChange={e => setForm({ ...form, theme: { ...form.theme, subline: e.target.value } })} placeholder="e.g. Answer a few quick questions and we'll get back to you." />
            </div>
            {/* Preview */}
            {(form.theme?.logoUrl || form.theme?.headline) && (
              <div style={{ marginTop: 12, padding: 20, background: 'rgba(0,0,0,0.03)', borderRadius: 10, textAlign: form.theme?.logoPosition === 'left' ? 'left' : 'center' }}>
                <span style={{ fontSize: 11, color: '#999', display: 'block', marginBottom: 8 }}>Preview:</span>
                {form.theme?.logoUrl && <img src={form.theme.logoUrl} alt="Logo" style={{ maxHeight: 48, marginBottom: 8 }} />}
                {form.theme?.headline && <div style={{ fontSize: 18, fontWeight: 700 }}>{form.theme.headline}</div>}
                {form.theme?.subline && <div style={{ fontSize: 14, color: 'var(--text-light)', marginTop: 4 }}>{form.theme.subline}</div>}
              </div>
            )}
          </div>

          {/* Footer Links */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>🔗</span>
              <div>
                <h3 style={{ margin: 0 }}>Footer Links</h3>
                <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Add up to 3 links below the form (e.g. Privacy Policy, Imprint, Terms).</p>
              </div>
            </div>
            <FooterLinksEditor
              links={form.theme?.footerLinks || []}
              onChange={links => setForm({ ...form, theme: { ...form.theme, footerLinks: links } })}
            />
          </div>

          {/* Custom CSS */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>💻</span>
              <div>
                <h3 style={{ margin: 0 }}>Custom CSS</h3>
                <p style={{ color: 'var(--text-light)', fontSize: 13, margin: 0 }}>Advanced: add custom CSS to override any form styles.</p>
              </div>
            </div>
            <div className="input-group">
              <label>CSS</label>
              <textarea
                className="input"
                rows={6}
                value={form.theme?.customCss || ''}
                onChange={e => setForm({ ...form, theme: { ...form.theme, customCss: e.target.value } })}
                placeholder={`.form-renderer { /* your styles */ }\n.form-btn { background: #ff6600; }`}
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </div>
          </div>
        </div>
      )}

      {/* GTM / GDPR Tab */}
      {activeTab === 'tracking' && (
        <div>
          {/* GTM */}
          <div className="card">
            <h3 style={{ marginBottom: 4 }}>Google Tag Manager</h3>
            <p style={{ color: '#636E72', fontSize: 13, marginBottom: 16 }}>
              GTM is injected automatically when this form is viewed. Events are pushed to the dataLayer on each step change and on submit.
            </p>
            <div className="input-group">
              <label>GTM Container ID</label>
              <input className="input" value={form.gtm_id || ''} onChange={e => setForm({ ...form, gtm_id: e.target.value })} placeholder="GTM-XXXXXXX" style={{ maxWidth: 300 }} />
            </div>
            {form.gtm_id && (
              <div style={{ padding: 12, background: '#f0f9f4', borderRadius: 8, fontSize: 13 }}>
                <strong>Events fired:</strong>
                <ul style={{ margin: '8px 0 0 16px', color: '#636E72' }}>
                  <li><code>openflow_step</code> — on each step change (formId, stepIndex, stepId)</li>
                  <li><code>openflow_submit</code> — on form submission (formId, formTitle)</li>
                </ul>
              </div>
            )}
          </div>

          {/* GDPR Consent */}
          <div className="card">
            <h3 style={{ marginBottom: 4 }}>GDPR / Submission Consent</h3>
            <p style={{ color: '#636E72', fontSize: 13, marginBottom: 16 }}>
              When enabled, a consent checkbox is automatically shown on the last step of the form before submission.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600, marginBottom: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!form.end_screen?.consentEnabled}
                onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, consentEnabled: e.target.checked } })}
                style={{ width: 20, height: 20, accentColor: 'var(--primary)' }}
              />
              Require consent before submission
            </label>
            {form.end_screen?.consentEnabled && (
              <div className="input-group">
                <label>Consent Text</label>
                <textarea
                  className="input"
                  rows={3}
                  value={form.end_screen?.consentText || 'I agree to the privacy policy and terms of service.'}
                  onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, consentText: e.target.value } })}
                  placeholder="I agree to the privacy policy and terms of service."
                />
              </div>
            )}
          </div>

          {/* Cookie / Tracking Consent Banner */}
          <div className="card">
            <h3 style={{ marginBottom: 4 }}>Cookie / Tracking Consent Banner</h3>
            <p style={{ color: '#636E72', fontSize: 13, marginBottom: 16 }}>
              When enabled, a cookie banner is shown to visitors <strong>before</strong> Google Tag Manager is loaded.
              GTM only fires after the visitor accepts. Consent is stored in the browser so the banner does not re-appear on subsequent visits.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600, marginBottom: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!form.end_screen?.cookieConsentEnabled}
                onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, cookieConsentEnabled: e.target.checked } })}
                style={{ width: 20, height: 20, accentColor: 'var(--primary)' }}
                disabled={!form.gtm_id}
              />
              Show cookie consent banner before loading GTM
            </label>
            {!form.gtm_id && (
              <p style={{ fontSize: 13, color: '#E17055', marginBottom: 8 }}>A GTM Container ID must be set above to use this feature.</p>
            )}
            {form.end_screen?.cookieConsentEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Banner Message</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={form.end_screen?.cookieConsentText || 'We use Google Tag Manager to analyze form interactions and improve your experience. Do you accept?'}
                    onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, cookieConsentText: e.target.value } })}
                    placeholder="We use Google Tag Manager to analyze form interactions…"
                  />
                </div>
                <div className="input-group">
                  <label>Accept Button Label</label>
                  <input
                    className="input"
                    value={form.end_screen?.cookieConsentAcceptLabel || 'Accept'}
                    onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, cookieConsentAcceptLabel: e.target.value } })}
                    placeholder="Accept"
                  />
                </div>
                <div className="input-group">
                  <label>Decline Button Label</label>
                  <input
                    className="input"
                    value={form.end_screen?.cookieConsentDeclineLabel || 'Decline'}
                    onChange={e => setForm({ ...form, end_screen: { ...form.end_screen, cookieConsentDeclineLabel: e.target.value } })}
                    placeholder="Decline"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <IntegrationsPanel formId={id} steps={form.steps} />
      )}

      {/* Embed Tab */}
      {activeTab === 'embed' && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Embed Form</h3>
          <p style={{ color: '#636E72', marginBottom: 24, fontSize: 14 }}>
            Copy the code and paste it into your landing page.
          </p>

          <SlugEditor
            form={form}
            onUpdated={(updated) => setForm(updated)}
            baseUrl={baseUrl}
          />

          {primaryHost && (
            <SubdomainEditor
              form={form}
              primaryHost={primaryHost}
              onUpdated={(updated) => setForm(updated)}
            />
          )}

          <div className="input-group">
            <label>Direct Link</label>
            <input className="input" readOnly value={`${baseUrl}/f/${form.slug}`} onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
          </div>

          <div className="input-group">
            <label>iFrame Embed Code</label>
            <textarea className="input" readOnly rows={4} value={`<iframe src="${baseUrl}/embed/${form.slug}" width="100%" height="600" frameborder="0" style="border:none;border-radius:12px;"></iframe>`} onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
          </div>

          <div className="input-group">
            <label>iFrame with Auto-Resize</label>
            <textarea className="input" readOnly rows={8} value={`<iframe id="openflow-${form.slug}" src="${baseUrl}/embed/${form.slug}" width="100%" height="600" frameborder="0" style="border:none;border-radius:12px;"></iframe>
<script>
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'openflow-resize') {
    document.getElementById('openflow-${form.slug}').style.height = e.data.height + 'px';
  }
});
</script>`} onClick={e => { e.target.select(); navigator.clipboard?.writeText(e.target.value); }} />
          </div>

          {form.published ? (
            <a href={`/f/${form.slug}`} target="_blank" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Open Preview
            </a>
          ) : (
            <p style={{ color: '#E67E22', fontSize: 14 }}>Publish the form to embed it.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ===========================
   StepEditor - Collapsible question card
   =========================== */
function StepEditor({ step, index, total, allSteps, expanded, onToggle, onChange, onChangeType, onMove, onCombine, onSplit, onRemove }) {
  const isGroup = step.type === 'group';
  const fieldDef = isGroup ? null : FIELD_TYPE_MAP[step.type];
  // Combining is only offered between two adjacent single questions (max 2 per step).
  const canCombineAbove = !isGroup && index > 0 && allSteps[index - 1]?.type !== 'group';
  const canCombineBelow = !isGroup && index < total - 1 && allSteps[index + 1]?.type !== 'group';
  const groupSummary = isGroup
    ? (step.fields || []).map(f => f.label || f.question || f.type).join('  +  ')
    : '';

  return (
    <div className="card" style={{ position: 'relative', marginBottom: 12 }}>
      {/* Collapsed header - always visible */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
          padding: expanded ? '0 0 16px 0' : 0,
          borderBottom: expanded ? '1px solid var(--border, #eee)' : 'none',
        }}
      >
        <span style={{ fontSize: 20 }}>{isGroup ? '🔗' : (fieldDef?.icon || '📝')}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {index + 1}. {isGroup ? 'Combined Step' : (fieldDef?.label || step.type)}
          </span>
          <div style={{ fontSize: 14, color: 'var(--text-light)', marginTop: 2 }}>
            {isGroup ? groupSummary : (step.question || <em style={{ opacity: 0.5 }}>No question set</em>)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
          <button className="btn btn-sm btn-secondary" onClick={() => onMove(-1)} disabled={index === 0} title="Move up">&uarr;</button>
          <button className="btn btn-sm btn-secondary" onClick={() => onMove(1)} disabled={index === total - 1} title="Move down">&darr;</button>
          {canCombineAbove && (
            <button className="btn btn-sm btn-secondary" onClick={() => onCombine(-1)} title="Combine with the question above">&uarr; Combine</button>
          )}
          {canCombineBelow && (
            <button className="btn btn-sm btn-secondary" onClick={() => onCombine(1)} title="Combine with the question below">&darr; Combine</button>
          )}
          {isGroup && (
            <button className="btn btn-sm btn-secondary" onClick={onSplit} title="Split back into separate questions">Split</button>
          )}
          <button className="btn btn-sm btn-danger" onClick={onRemove}>Remove</button>
        </div>
        <span style={{ fontSize: 18, color: 'var(--text-light)', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ paddingTop: 16 }}>
          {isGroup ? (
            <GroupFieldsEditor step={step} allSteps={allSteps} onChange={onChange} />
          ) : (<>
          {/* Field Type Selector - visual grid */}
          <div className="input-group">
            <label>Field Type</label>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 4,
            }}>
              {FIELD_TYPES.map(ft => (
                <button
                  key={ft.value}
                  onClick={() => onChangeType(ft.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px',
                    border: step.type === ft.value ? '2px solid var(--primary)' : '2px solid var(--border)',
                    borderRadius: 10,
                    background: step.type === ft.value ? 'rgba(108,92,231,0.08)' : 'transparent',
                    cursor: 'pointer', fontSize: 13, fontWeight: step.type === ft.value ? 700 : 500,
                    color: step.type === ft.value ? 'var(--primary)' : 'var(--text)',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 18 }}>{ft.icon}</span>
                  {ft.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div className="input-group">
              <label>Question</label>
              <input className="input" value={step.question || ''} onChange={e => onChange({ question: e.target.value })} placeholder="Your question..." />
            </div>
            <div className="input-group">
              <label>Label / ID</label>
              <input className="input" value={step.label || ''} onChange={e => onChange({ label: e.target.value })} placeholder="e.g. Name, Email..." />
            </div>
          </div>

          {/* Placeholder - not for types that don't use it */}
          {!['select', 'multi-select', 'yes-no', 'rating', 'image-select', 'address'].includes(step.type) && (
            <div className="input-group" style={{ marginTop: 12 }}>
              <label>Placeholder</label>
              <input className="input" value={step.placeholder || ''} onChange={e => onChange({ placeholder: e.target.value })} placeholder="Placeholder text..." />
            </div>
          )}

          {/* Options for select types */}
          {(step.type === 'select' || step.type === 'multi-select') && (
            <>
              <div className="input-group" style={{ marginTop: 12 }}>
                <label>Options</label>
                {step.pricingFilter?.enabled ? (
                  <PricingOptionsEditor
                    options={step.options || []}
                    onChange={options => onChange({ options })}
                  />
                ) : (
                  <OptionsTextarea options={step.options || []} onChange={onChange} />
                )}
              </div>
              <PricingFilterEditor
                pricingFilter={step.pricingFilter}
                allSteps={allSteps}
                currentStepId={step.id}
                options={step.options || []}
                onChange={(pf, opts) => onChange({ pricingFilter: pf, ...(opts !== undefined ? { options: opts } : {}) })}
              />
            </>
          )}

          {/* Image/Icon Select - visual editor */}
          {step.type === 'image-select' && (
            <ImageSelectEditor
              options={step.options || []}
              onChange={options => onChange({ options })}
            />
          )}

          {/* File upload config */}
          {step.type === 'file-upload' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
              <div className="input-group">
                <label>Accepted File Types</label>
                <input className="input" value={step.accept || '.pdf,.jpg,.png,.doc,.docx'} onChange={e => onChange({ accept: e.target.value })} placeholder=".pdf,.jpg,.png" />
                <span style={{ fontSize: 11, color: '#999', marginTop: 4, display: 'block' }}>Comma-separated extensions</span>
              </div>
              <div className="input-group">
                <label>Max File Size (MB)</label>
                <input className="input" type="number" min={1} max={50} value={step.maxSizeMB || 10} onChange={e => onChange({ maxSizeMB: parseInt(e.target.value) || 10 })} style={{ width: 100 }} />
              </div>
            </div>
          )}

          {/* Address sub-fields config */}
          {step.type === 'address' && (
            <div style={{ marginTop: 12, padding: 16, background: '#f8f9fa', borderRadius: 10 }}>
              <p style={{ fontSize: 13, color: '#636E72', marginBottom: 8 }}>
                This field automatically collects: <strong>Street</strong>, <strong>Postal Code</strong>, <strong>City</strong>, and optionally <strong>Country</strong>.
              </p>

              {/* Custom placeholder labels for core sub-fields */}
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 13, color: '#636E72', marginBottom: 8 }}>Field labels (leave blank to use defaults):</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input className="input" value={(step.addressLabels || {}).street || ''} onChange={e => onChange({ addressLabels: { ...(step.addressLabels || {}), street: e.target.value } })} placeholder="Street and house number *" />
                  <input className="input" value={(step.addressLabels || {}).postalCode || ''} onChange={e => onChange({ addressLabels: { ...(step.addressLabels || {}), postalCode: e.target.value } })} placeholder="Postal code *" />
                  <input className="input" value={(step.addressLabels || {}).city || ''} onChange={e => onChange({ addressLabels: { ...(step.addressLabels || {}), city: e.target.value } })} placeholder="City *" />
                  <input className="input" value={(step.addressLabels || {}).country || ''} onChange={e => onChange({ addressLabels: { ...(step.addressLabels || {}), country: e.target.value } })} placeholder="Country (optional)" />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={step.showCountry !== false} onChange={e => onChange({ showCountry: e.target.checked })} />
                Include country field
              </label>

              {/* Custom fields */}
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 13, color: '#636E72', marginBottom: 8 }}>Custom sub-fields:</p>
                {(step.customFields || []).map((field, idx) => (
                  <div key={idx} style={{ background: '#fff', padding: 12, borderRadius: 8, marginBottom: 8, border: '1px solid #e0e0e0' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <select className="input" value={field.type} onChange={e => {
                        const updated = [...(step.customFields || [])];
                        updated[idx] = { ...field, type: e.target.value };
                        onChange({ customFields: updated });
                      }} style={{ width: 120 }}>
                        <option value="text">Text</option>
                        <option value="dropdown">Dropdown</option>
                        <option value="radio">Radio</option>
                      </select>
                      <input className="input" value={field.label || ''} onChange={e => {
                        const updated = [...(step.customFields || [])];
                        updated[idx] = { ...field, label: e.target.value };
                        onChange({ customFields: updated });
                      }} placeholder="Label" style={{ flex: 1 }} />
                      <button className="btn btn-sm btn-secondary" onClick={() => {
                        const updated = (step.customFields || []).filter((_, i) => i !== idx);
                        onChange({ customFields: updated });
                      }}>×</button>
                    </div>
                    {(field.type === 'dropdown' || field.type === 'radio') && (
                      <input className="input" value={field.options || ''} onChange={e => {
                        const updated = [...(step.customFields || [])];
                        updated[idx] = { ...field, options: e.target.value };
                        onChange({ customFields: updated });
                      }} placeholder="Options (comma-separated)" style={{ width: '100%' }} />
                    )}
                  </div>
                ))}
                <button className="btn btn-sm btn-secondary" onClick={() => {
                  const newField = { type: 'text', label: '', id: `custom_${Date.now()}` };
                  onChange({ customFields: [...(step.customFields || []), newField] });
                }}>+ Add custom field</button>
              </div>
            </div>
          )}

          {/* Rating max config */}
          {step.type === 'rating' && (
            <div className="input-group" style={{ marginTop: 12 }}>
              <label>Max Stars</label>
              <input className="input" type="number" min={3} max={10} value={step.max || 5} onChange={e => onChange({ max: parseInt(e.target.value) || 5 })} style={{ width: 100 }} />
            </div>
          )}

          {/* Number min/max */}
          {step.type === 'number' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
              <div className="input-group">
                <label>Min</label>
                <input className="input" type="number" value={step.min || ''} onChange={e => onChange({ min: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="No minimum" />
              </div>
              <div className="input-group">
                <label>Max</label>
                <input className="input" type="number" value={step.max || ''} onChange={e => onChange({ max: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="No maximum" />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={step.required || false} onChange={e => onChange({ required: e.target.checked })} />
              Required
            </label>
          </div>

          {/* Conditional Logic */}
          <ConditionEditor
            condition={step.condition}
            allSteps={allSteps}
            currentStepId={step.id}
            onChange={condition => onChange({ condition })}
          />
          </>)}
        </div>
      )}
    </div>
  );
}

/* ===========================
   GroupFieldsEditor - edits the two sub-fields of a combined step
   =========================== */
function GroupFieldsEditor({ step, allSteps, onChange }) {
  const fields = step.fields || [];

  function updateField(i, changes) {
    onChange({ fields: fields.map((f, idx) => (idx === i ? { ...f, ...changes } : f)) });
  }

  function changeFieldType(i, newType) {
    const def = FIELD_TYPE_MAP[newType];
    const d = def?.defaults || {};
    onChange({
      fields: fields.map((f, idx) => (idx === i ? {
        id: f.id,
        type: newType,
        question: d.question || '',
        label: d.label || '',
        placeholder: d.placeholder || '',
        required: f.required || false,
        ...(d.options ? { options: d.options } : {}),
      } : f)),
    });
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 16 }}>
        This step shows two questions on one screen. Use <strong>Split</strong> on the step header to separate them again.
      </p>
      {fields.map((f, i) => (
        <div key={f.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
            Question {i + 1}
          </div>
          <SubFieldEditor
            field={f}
            onChange={changes => updateField(i, changes)}
            onChangeType={type => changeFieldType(i, type)}
          />
        </div>
      ))}

      {/* Either/or requirement across the two fields */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 4 }}>
        <input type="checkbox" checked={!!step.requireOne} onChange={e => onChange({ requireOne: e.target.checked })} />
        Require at least one answer (either field)
      </label>
      <p style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8 }}>
        The visitor must fill in at least one of the two. Use each field's own <strong>Required</strong> toggle to force that specific field instead.
      </p>

      {/* The combined step is shown/hidden as a unit via a group-level condition. */}
      <ConditionEditor
        condition={step.condition}
        allSteps={allSteps}
        currentStepId={step.id}
        onChange={condition => onChange({ condition })}
      />
    </>
  );
}

/* ===========================
   SubFieldEditor - compact editor for a single field inside a combined step
   =========================== */
function SubFieldEditor({ field, onChange, onChangeType }) {
  return (
    <>
      <div className="input-group">
        <label>Field Type</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 4 }}>
          {FIELD_TYPES.map(ft => (
            <button
              key={ft.value}
              onClick={() => onChangeType(ft.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                border: field.type === ft.value ? '2px solid var(--primary)' : '2px solid var(--border)',
                borderRadius: 10,
                background: field.type === ft.value ? 'rgba(108,92,231,0.08)' : 'transparent',
                cursor: 'pointer', fontSize: 13, fontWeight: field.type === ft.value ? 700 : 500,
                color: field.type === ft.value ? 'var(--primary)' : 'var(--text)',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 18 }}>{ft.icon}</span>
              {ft.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="input-group">
          <label>Question</label>
          <input className="input" value={field.question || ''} onChange={e => onChange({ question: e.target.value })} placeholder="Your question..." />
        </div>
        <div className="input-group">
          <label>Label / ID</label>
          <input className="input" value={field.label || ''} onChange={e => onChange({ label: e.target.value })} placeholder="e.g. Name, Email..." />
        </div>
      </div>

      {!['select', 'multi-select', 'yes-no', 'rating', 'image-select', 'address'].includes(field.type) && (
        <div className="input-group" style={{ marginTop: 12 }}>
          <label>Placeholder</label>
          <input className="input" value={field.placeholder || ''} onChange={e => onChange({ placeholder: e.target.value })} placeholder="Placeholder text..." />
        </div>
      )}

      {(field.type === 'select' || field.type === 'multi-select') && (
        <div className="input-group" style={{ marginTop: 12 }}>
          <label>Options</label>
          <OptionsTextarea options={field.options || []} onChange={onChange} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={field.required || false} onChange={e => onChange({ required: e.target.checked })} />
          Required
        </label>
      </div>
    </>
  );
}

/* ===========================
   SlugEditor - editable form URL slug
   =========================== */
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 60;
const SLUG_RESERVED = new Set([
  'admin', 'api', 'login', 'logout', 'embed', 'f',
  'dashboard', 'forms', 'public', 'assets', 'static',
  'settings', 'auth', 'signup', 'signin', 'register',
  'health', 'robots', 'sitemap', 'favicon', 'www',
]);

function validateSlugClient(slug) {
  if (slug.length < SLUG_MIN) return `At least ${SLUG_MIN} characters required.`;
  if (slug.length > SLUG_MAX) return `At most ${SLUG_MAX} characters allowed.`;
  if (!SLUG_REGEX.test(slug)) return 'Use only lowercase letters, digits, and hyphens (no leading/trailing or consecutive hyphens).';
  if (SLUG_RESERVED.has(slug)) return `"${slug}" is reserved and cannot be used.`;
  return '';
}

function SlugEditor({ form, onUpdated, baseUrl }) {
  const [value, setValue] = useState(form.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { setValue(form.slug); }, [form.slug]);

  const trimmed = value.trim();
  const clientError = trimmed && trimmed !== form.slug ? validateSlugClient(trimmed) : '';
  const dirty = trimmed !== form.slug;
  const canSave = dirty && !clientError && !saving;

  async function save() {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const { form: updated } = await api.updateForm(form.id, { slug: trimmed });
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message || 'Failed to update URL');
    } finally {
      setSaving(false);
    }
  }

  const displayError = error || clientError;

  return (
    <div className="input-group">
      <label>Form URL</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{
          display: 'flex', alignItems: 'center', padding: '0 12px',
          background: 'rgba(0,0,0,0.04)', border: '1px solid var(--border, #e0e0e0)',
          borderRight: 'none', borderRadius: '8px 0 0 8px',
          color: 'var(--text-light)', fontSize: 14, whiteSpace: 'nowrap',
        }}>
          {baseUrl}/f/
        </div>
        <input
          className="input"
          value={value}
          onChange={e => setValue(e.target.value)}
          spellCheck={false}
          style={{
            borderRadius: '0 8px 8px 0',
            borderLeft: 'none',
            flex: 1,
            fontFamily: 'monospace',
          }}
          onKeyDown={e => { if (e.key === 'Enter' && canSave) save(); }}
        />
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={!canSave}
          style={{ whiteSpace: 'nowrap' }}
        >
          {saving ? 'Saving...' : 'Update URL'}
        </button>
      </div>
      <div style={{ marginTop: 6, minHeight: 18, fontSize: 12 }}>
        {displayError ? (
          <span style={{ color: '#E17055' }}>{displayError}</span>
        ) : saved ? (
          <span style={{ color: '#00B894' }}>URL updated. The previous URL will redirect to the new one.</span>
        ) : (
          <span style={{ color: '#999' }}>Lowercase letters, digits and hyphens. 3–60 characters.</span>
        )}
      </div>
    </div>
  );
}

/* ===========================
   SubdomainEditor - bind a form to a vanity subdomain of the operator host
   =========================== */
const SUBDOMAIN_RESERVED = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'ftp', 'dashboard',
  'auth', 'login', 'logout', 'status', 'blog', 'docs', 'help',
  'support', 'cdn', 'static', 'assets', 'embed', 'public',
  'mx', 'smtp', 'imap', 'pop', 'pop3', 'ns', 'ns1', 'ns2',
  'autodiscover', 'autoconfig', 'webmail',
]);

function validateSubdomainClient(value) {
  if (value.length < SLUG_MIN) return `At least ${SLUG_MIN} characters required.`;
  if (value.length > SLUG_MAX) return `At most ${SLUG_MAX} characters allowed.`;
  if (!SLUG_REGEX.test(value)) return 'Use only lowercase letters, digits, and hyphens (no leading/trailing or consecutive hyphens).';
  if (SUBDOMAIN_RESERVED.has(value)) return `"${value}" is reserved and cannot be used as a subdomain.`;
  return '';
}

function SubdomainEditor({ form, primaryHost, onUpdated }) {
  const current = form.subdomain || '';
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { setValue(form.subdomain || ''); }, [form.subdomain]);

  const trimmed = value.trim().toLowerCase();
  const dirty = trimmed !== (current || '');
  const clientError = trimmed && dirty ? validateSubdomainClient(trimmed) : '';
  const canSave = dirty && !clientError && !saving;

  async function save(newValue) {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const { form: updated } = await api.updateForm(form.id, { subdomain: newValue || null });
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message || 'Failed to update subdomain');
    } finally {
      setSaving(false);
    }
  }

  const displayError = error || clientError;

  return (
    <div className="input-group">
      <label>Custom subdomain (optional)</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          className="input"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="acme"
          spellCheck={false}
          style={{
            borderRadius: '8px 0 0 8px',
            flex: 1,
            fontFamily: 'monospace',
          }}
          onKeyDown={e => { if (e.key === 'Enter' && canSave) save(trimmed); }}
        />
        <div style={{
          display: 'flex', alignItems: 'center', padding: '0 12px',
          background: 'rgba(0,0,0,0.04)', border: '1px solid var(--border, #e0e0e0)',
          borderLeft: 'none', borderRadius: '0 8px 8px 0',
          color: 'var(--text-light)', fontSize: 14, whiteSpace: 'nowrap',
        }}>
          .{primaryHost}
        </div>
        <button
          className="btn btn-primary"
          onClick={() => save(trimmed)}
          disabled={!canSave}
          style={{ whiteSpace: 'nowrap' }}
        >
          {saving ? 'Saving...' : 'Update'}
        </button>
        {current && !dirty && (
          <button
            className="btn btn-secondary"
            onClick={() => { setValue(''); save(''); }}
            disabled={saving}
            style={{ whiteSpace: 'nowrap' }}
          >
            Remove
          </button>
        )}
      </div>
      <div style={{ marginTop: 6, minHeight: 18, fontSize: 12 }}>
        {displayError ? (
          <span style={{ color: '#E17055' }}>{displayError}</span>
        ) : saved ? (
          <span style={{ color: '#00B894' }}>
            {trimmed ? `Your form is now reachable at https://${trimmed}.${primaryHost}` : 'Custom subdomain removed.'}
          </span>
        ) : current ? (
          <span style={{ color: '#999' }}>
            Live at <a href={`https://${current}.${primaryHost}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
              https://{current}.{primaryHost}
            </a>. Publish the form for it to be reachable.
          </span>
        ) : (
          <span style={{ color: '#999' }}>
            Serve this form at its own subdomain of <code>{primaryHost}</code>. Requires a wildcard DNS record to be configured by the operator.
          </span>
        )}
      </div>
    </div>
  );
}

/* ===========================
   OptionsTextarea - Textarea for editing select/multi-select options
   Uses local state so trailing newlines are preserved while typing
   =========================== */
function OptionsTextarea({ options, onChange }) {
  const toText = opts => (opts || []).map(o => typeof o === 'string' ? o : o.label).join('\n');
  const [text, setText] = useState(() => toText(options));
  const prevText = useRef(text);

  // Sync if parent changes options externally (e.g. switching steps)
  const canonicalText = toText(options);
  if (canonicalText !== toText(prevText.current.split('\n').filter(Boolean))) {
    if (text.split('\n').filter(Boolean).join('\n') !== canonicalText) {
      setText(canonicalText);
    }
  }

  return (
    <textarea
      className="input"
      rows={4}
      value={text}
      onChange={e => {
        const val = e.target.value;
        setText(val);
        prevText.current = val;
        onChange({ options: val.split('\n').filter(Boolean) });
      }}
      placeholder={"Option 1\nOption 2\nOption 3"}
    />
  );
}

/* ===========================
   ImageSelectEditor - Visual editor for image/icon options
   =========================== */
function ImageSelectEditor({ options, onChange }) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(null); // index of option being edited
  const [activeCategory, setActiveCategory] = useState('Popular');

  function addOption() {
    onChange([...options, { value: `opt_${Date.now()}`, label: 'New Option', icon: '⭐' }]);
  }

  function updateOption(index, changes) {
    const updated = [...options];
    updated[index] = { ...updated[index], ...changes };
    onChange(updated);
  }

  function removeOption(index) {
    onChange(options.filter((_, i) => i !== index));
    if (showEmojiPicker === index) setShowEmojiPicker(null);
  }

  function moveOption(index, dir) {
    const updated = [...options];
    const target = index + dir;
    if (target < 0 || target >= updated.length) return;
    [updated[index], updated[target]] = [updated[target], updated[index]];
    onChange(updated);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13, color: '#555' }}>
        Options
      </label>

      {/* Option cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt, i) => {
          const optObj = typeof opt === 'string' ? { value: opt, label: opt, icon: '' } : opt;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: '#f8f9fa', borderRadius: 10, border: '1px solid #e8e8e8',
            }}>
              {/* Icon/Emoji display + picker trigger */}
              <button
                onClick={() => setShowEmojiPicker(showEmojiPicker === i ? null : i)}
                style={{
                  width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 24, border: '2px dashed #ccc', borderRadius: 10, background: 'white', cursor: 'pointer',
                  transition: 'all 0.15s',
                  ...(showEmojiPicker === i ? { borderColor: 'var(--primary, #6C5CE7)', background: 'rgba(108,92,231,0.05)' } : {}),
                }}
                title="Pick icon"
              >
                {optObj.icon || optObj.image ? (
                  optObj.image ? <img src={optObj.image} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} /> : optObj.icon
                ) : '➕'}
              </button>

              {/* Label + value */}
              <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  value={optObj.label || ''}
                  onChange={e => updateOption(i, { label: e.target.value })}
                  placeholder="Label"
                  style={{ fontSize: 14, padding: '8px 10px' }}
                />
                <input
                  className="input"
                  value={optObj.value || ''}
                  onChange={e => updateOption(i, { value: e.target.value })}
                  placeholder="Value"
                  style={{ fontSize: 14, padding: '8px 10px', width: 120 }}
                />
              </div>

              {/* Image URL input */}
              <input
                className="input"
                value={optObj.image || ''}
                onChange={e => updateOption(i, { image: e.target.value, icon: e.target.value ? '' : optObj.icon })}
                placeholder="Image URL (1:1, min 200x200)"
                title="Recommended: square image (1:1 ratio), minimum 200x200px. PNG, JPG, SVG or WebP."
                style={{ fontSize: 12, padding: '8px 10px', width: 200 }}
              />

              {/* Controls */}
              <div style={{ display: 'flex', gap: 2 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => moveOption(i, -1)} disabled={i === 0} style={{ padding: '4px 6px', fontSize: 11 }}>&uarr;</button>
                <button className="btn btn-sm btn-secondary" onClick={() => moveOption(i, 1)} disabled={i === options.length - 1} style={{ padding: '4px 6px', fontSize: 11 }}>&darr;</button>
                <button className="btn btn-sm btn-danger" onClick={() => removeOption(i)} style={{ padding: '4px 6px', fontSize: 11 }}>x</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Emoji picker dropdown */}
      {showEmojiPicker !== null && (
        <EmojiPicker
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          onSelect={(emoji) => {
            updateOption(showEmojiPicker, { icon: emoji, image: '' });
            setShowEmojiPicker(null);
          }}
          onClose={() => setShowEmojiPicker(null)}
        />
      )}

      <button
        className="btn btn-secondary"
        onClick={addOption}
        style={{ marginTop: 10, width: '100%', justifyContent: 'center', padding: 10, fontSize: 13 }}
      >
        + Add Option
      </button>
    </div>
  );
}

/* ===========================
   ConditionEditor - Show/hide step based on previous answer
   =========================== */
function ConditionEditor({ condition, allSteps, currentStepId, onChange }) {
  const enabled = !!condition;
  // Build the list of referenceable fields, expanding combined steps into their
  // individual sub-fields and excluding the current step (and its own sub-fields).
  const fieldOptions = [];
  for (const s of allSteps) {
    if (s.id === currentStepId) continue;
    if (s.type === 'group' && Array.isArray(s.fields)) {
      for (const f of s.fields) fieldOptions.push({ id: f.id, label: f.label || f.id });
    } else {
      fieldOptions.push({ id: s.id, label: s.label || s.id });
    }
  }

  function toggle() {
    if (enabled) {
      onChange(null);
    } else {
      onChange({ field: fieldOptions[0]?.id || '', op: 'equals', value: '' });
    }
  }

  if (fieldOptions.length === 0) return null;

  return (
    <div style={{ marginTop: 16, padding: 14, background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Conditional Logic
      </label>
      {enabled && condition && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-light)' }}>Show this step only if</span>
          <select className="input" value={condition.field || ''} onChange={e => onChange({ ...condition, field: e.target.value })} style={{ width: 'auto', minWidth: 140, padding: '6px 10px', fontSize: 13 }}>
            <option value="">-- Select field --</option>
            {fieldOptions.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <select className="input" value={condition.op || 'equals'} onChange={e => onChange({ ...condition, op: e.target.value })} style={{ width: 'auto', padding: '6px 10px', fontSize: 13 }}>
            <option value="equals">equals</option>
            <option value="not_equals">does not equal</option>
            <option value="contains">contains</option>
            <option value="is_set">is answered</option>
            <option value="is_not_set">is not answered</option>
          </select>
          {!['is_set', 'is_not_set'].includes(condition.op) && (
            <input className="input" value={condition.value || ''} onChange={e => onChange({ ...condition, value: e.target.value })} placeholder="Value" style={{ width: 'auto', minWidth: 120, padding: '6px 10px', fontSize: 13 }} />
          )}
        </div>
      )}
    </div>
  );
}

/* ===========================
   PricingOptionsEditor - Per-option label + maxBudget when pricing filter is on
   =========================== */
function PricingOptionsEditor({ options, onChange }) {
  function updateOption(i, changes) {
    const updated = [...options];
    updated[i] = { ...updated[i], ...changes };
    onChange(updated);
  }

  function addOption() {
    onChange([...options, { label: '', maxBudget: '' }]);
  }

  function removeOption(i) {
    onChange(options.filter((_, idx) => idx !== i));
  }

  const normalized = options.map(o => typeof o === 'string' ? { label: o, maxBudget: '' } : o);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 28px', gap: 6, fontSize: 12, color: '#888', marginBottom: 2 }}>
        <span>Option label</span>
        <span>Max value</span>
        <span />
      </div>
      {normalized.map((opt, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 28px', gap: 6, alignItems: 'center' }}>
          <input
            className="input"
            value={opt.label || ''}
            onChange={e => updateOption(i, { label: e.target.value })}
            placeholder="e.g. 1000–2000€"
            style={{ fontSize: 13 }}
          />
          <input
            className="input"
            type="number"
            min={0}
            value={opt.maxBudget === '' || opt.maxBudget === undefined ? '' : opt.maxBudget}
            onChange={e => updateOption(i, { maxBudget: e.target.value === '' ? '' : Number(e.target.value) })}
            placeholder="upper bound"
            style={{ fontSize: 13 }}
          />
          <button className="btn btn-sm btn-danger" onClick={() => removeOption(i)} style={{ padding: '4px 8px' }}>×</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" onClick={addOption} style={{ marginTop: 4, alignSelf: 'flex-start' }}>+ Add option</button>
      <p style={{ fontSize: 11, color: '#999', margin: '4px 0 0' }}>
        Set the upper bound for each option. Options whose ceiling falls below the calculated minimum (quantity × rate) will be hidden.
      </p>
    </div>
  );
}

/* ===========================
   PricingFilterEditor - Flat-rate pricing filter config for select fields
   =========================== */
function PricingFilterEditor({ pricingFilter, allSteps, currentStepId, options, onChange }) {
  const enabled = !!pricingFilter?.enabled;
  const otherSteps = allSteps.filter(s => s.id !== currentStepId);

  function toggle() {
    if (enabled) {
      // Convert options back to plain strings when disabling
      const plainOptions = options.map(o => typeof o === 'string' ? o : (o.label || ''));
      onChange(null, plainOptions);
    } else {
      // Convert options to extended objects when enabling
      const extOptions = options.map(o => typeof o === 'string' ? { label: o, maxBudget: '' } : o);
      onChange({ enabled: true, field: otherSteps[0]?.id || '', rate: 40 }, extOptions);
    }
  }

  return (
    <div style={{ marginTop: 12, padding: 14, background: '#fafafa', borderRadius: 10, border: '1px solid #eee' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Flat-rate Pricing Filter
      </label>
      {enabled && pricingFilter && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, color: '#636E72', marginBottom: 10 }}>
            Automatically hide options whose maximum value falls below <em>quantity × rate</em>. Useful any time a choice depends on a calculated minimum (e.g. price per person, price per item).
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#636E72' }}>Quantity field</span>
            <select
              className="input"
              value={pricingFilter.field || ''}
              onChange={e => onChange({ ...pricingFilter, field: e.target.value })}
              style={{ width: 'auto', minWidth: 140, padding: '6px 10px', fontSize: 13 }}
            >
              <option value="">-- Select field --</option>
              {otherSteps.map(s => (
                <option key={s.id} value={s.id}>{s.label || s.question || s.id}</option>
              ))}
            </select>
            <span style={{ fontSize: 13, color: '#636E72' }}>× rate</span>
            <input
              className="input"
              type="number"
              min={1}
              value={pricingFilter.rate ?? 40}
              onChange={e => onChange({ ...pricingFilter, rate: Number(e.target.value) || 40 })}
              style={{ width: 80, padding: '6px 10px', fontSize: 13 }}
            />
            <span style={{ fontSize: 13, color: '#636E72' }}>per unit</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===========================
   FooterLinksEditor - Max 3 footer links
   =========================== */
function FooterLinksEditor({ links, onChange }) {
  function updateLink(index, changes) {
    const updated = [...links];
    updated[index] = { ...updated[index], ...changes };
    onChange(updated);
  }

  function addLink() {
    if (links.length >= 3) return;
    onChange([...links, { title: '', url: '' }]);
  }

  function removeLink(index) {
    onChange(links.filter((_, i) => i !== index));
  }

  return (
    <div>
      {links.map((link, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input className="input" value={link.title || ''} onChange={e => updateLink(i, { title: e.target.value })} placeholder="Link title" style={{ flex: 1 }} />
          <input className="input" value={link.url || ''} onChange={e => updateLink(i, { url: e.target.value })} placeholder="https://..." style={{ flex: 2 }} />
          <button className="btn btn-sm btn-danger" onClick={() => removeLink(i)}>x</button>
        </div>
      ))}
      {links.length < 3 && (
        <button className="btn btn-secondary btn-sm" onClick={addLink} style={{ marginTop: 4 }}>
          + Add Link
        </button>
      )}
    </div>
  );
}

/* ===========================
   EmojiPicker - Category-based emoji selector
   =========================== */
function EmojiPicker({ activeCategory, onCategoryChange, onSelect, onClose }) {
  const ref = useRef();

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      marginTop: 8, border: '1px solid #e0e0e0', borderRadius: 12, background: 'white',
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)', overflow: 'hidden', maxWidth: 420,
    }}>
      {/* Category tabs */}
      <div style={{
        display: 'flex', gap: 0, overflowX: 'auto', borderBottom: '1px solid #eee',
        padding: '0 4px',
      }}>
        {Object.keys(EMOJI_CATEGORIES).map(cat => (
          <button
            key={cat}
            onClick={() => onCategoryChange(cat)}
            style={{
              padding: '8px 12px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: activeCategory === cat ? 'var(--primary, #6C5CE7)' : 'transparent',
              color: activeCategory === cat ? 'white' : '#888',
              borderRadius: '6px 6px 0 0', whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, padding: 8, maxHeight: 180, overflowY: 'auto',
      }}>
        {(EMOJI_CATEGORIES[activeCategory] || []).map((emoji, i) => (
          <button
            key={i}
            onClick={() => onSelect(emoji)}
            style={{
              width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => e.target.style.background = '#f0f0f0'}
            onMouseLeave={e => e.target.style.background = 'transparent'}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ===========================
   ThemePreview - Animated background live preview
   =========================== */
function ThemePreview({ theme }) {
  const bgAnimation = theme.backgroundAnimation || 'none';
  const primaryColor = theme.primaryColor || '#6C5CE7';
  const accentColor = theme.accentColor || adjustColor(primaryColor, 40);
  const bgColor = theme.backgroundColor || '#FFFFFF';
  const textColor = theme.textColor || '#2D3436';

  const cssVars = {
    '--form-primary': primaryColor,
    '--form-bg': bgColor,
    '--form-text': textColor,
    '--form-bg-accent': accentColor,
  };

  return (
    <div style={{
      position: 'relative',
      height: 200,
      borderRadius: 12,
      overflow: 'hidden',
      border: '1px solid var(--border)',
      background: bgColor,
      ...cssVars,
    }}>
      {/* Animated background shapes */}
      {bgAnimation !== 'none' && BG_SHAPE_COUNTS[bgAnimation] && (
        <div className={`form-bg-animation bg-${bgAnimation}`}>
          {Array.from({ length: BG_SHAPE_COUNTS[bgAnimation] }, (_, i) => <span key={i} />)}
        </div>
      )}
      {/* Placeholder form content */}
      <div style={{ position: 'relative', zIndex: 1, padding: '28px 32px', color: textColor, fontFamily: theme.fontFamily || 'inherit' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: primaryColor, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, opacity: 0.8 }}>
          1 / 3
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>How does your form look?</div>
        <button style={{
          background: primaryColor, color: '#fff',
          border: 'none', padding: '10px 22px',
          borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'default',
        }}>
          {theme.nextButtonLabel || 'Next'} →
        </button>
      </div>
      {bgAnimation === 'none' && (
        <div style={{ position: 'absolute', bottom: 10, right: 14, fontSize: 12, color: textColor, opacity: 0.35 }}>
          No animation selected
        </div>
      )}
    </div>
  );
}
