import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import IntegrationsPanel from '../components/IntegrationsPanel';

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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('steps');
  const [expandedStep, setExpandedStep] = useState(null);

  useEffect(() => {
    api.getForm(id).then(d => setForm(d.form));
  }, [id]);

  if (!form) return <div>Loading...</div>;

  async function save(updates = {}) {
    setSaving(true);
    setSaved(false);
    const payload = {
      title: form.title,
      steps: form.steps,
      end_screen: form.end_screen,
      theme: form.theme,
      gtm_id: form.gtm_id,
      published: form.published,
      ...updates,
    };
    const { form: updated } = await api.updateForm(id, payload);
    setForm(updated);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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

  const baseUrl = window.location.origin;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Link to="/" style={{ color: '#636E72', textDecoration: 'none', fontSize: 13 }}>&larr; Back</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              style={{ fontSize: 24, fontWeight: 700, border: 'none', background: 'none', padding: 0, outline: 'none', width: 400, color: 'var(--text)' }}
            />
            <span className={`badge ${form.published ? 'badge-published' : 'badge-draft'}`}>
              {form.published ? 'Live' : 'Draft'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: '#00B894', fontSize: 13 }}>Saved!</span>}
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
        </div>
      )}

      {/* Theme Tab */}
      {activeTab === 'theme' && (
        <div>
          {/* Colors */}
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Colors</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div className="input-group">
                <label>Primary Color</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="color" value={form.theme?.primaryColor || '#6C5CE7'} onChange={e => setForm({ ...form, theme: { ...form.theme, primaryColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                  <input className="input" value={form.theme?.primaryColor || '#6C5CE7'} onChange={e => setForm({ ...form, theme: { ...form.theme, primaryColor: e.target.value } })} />
                </div>
              </div>
              <div className="input-group">
                <label>Background Color</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="color" value={form.theme?.backgroundColor || '#FFFFFF'} onChange={e => setForm({ ...form, theme: { ...form.theme, backgroundColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                  <input className="input" value={form.theme?.backgroundColor || '#FFFFFF'} onChange={e => setForm({ ...form, theme: { ...form.theme, backgroundColor: e.target.value } })} />
                </div>
              </div>
              <div className="input-group">
                <label>Text Color</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="color" value={form.theme?.textColor || '#2D3436'} onChange={e => setForm({ ...form, theme: { ...form.theme, textColor: e.target.value } })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                  <input className="input" value={form.theme?.textColor || '#2D3436'} onChange={e => setForm({ ...form, theme: { ...form.theme, textColor: e.target.value } })} />
                </div>
              </div>
            </div>
          </div>

          {/* Header / Landing Page */}
          <div className="card">
            <h3 style={{ marginBottom: 4 }}>Header / Landing Page</h3>
            <p style={{ color: '#636E72', fontSize: 13, marginBottom: 16 }}>
              Add a logo and tagline on top of your form to make it work as a standalone landing page.
            </p>
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
              <div style={{ marginTop: 12, padding: 20, background: '#f8f9fa', borderRadius: 10, textAlign: form.theme?.logoPosition === 'left' ? 'left' : 'center' }}>
                <span style={{ fontSize: 11, color: '#999', display: 'block', marginBottom: 8 }}>Preview:</span>
                {form.theme?.logoUrl && <img src={form.theme.logoUrl} alt="Logo" style={{ maxHeight: 48, marginBottom: 8 }} />}
                {form.theme?.headline && <div style={{ fontSize: 18, fontWeight: 700, color: '#2D3436' }}>{form.theme.headline}</div>}
                {form.theme?.subline && <div style={{ fontSize: 14, color: '#636E72', marginTop: 4 }}>{form.theme.subline}</div>}
              </div>
            )}
          </div>

          {/* Footer Links */}
          <div className="card">
            <h3 style={{ marginBottom: 4 }}>Footer Links</h3>
            <p style={{ color: '#636E72', fontSize: 13, marginBottom: 16 }}>
              Add up to 3 links below the form (e.g. Privacy Policy, Imprint, Terms).
            </p>
            <FooterLinksEditor
              links={form.theme?.footerLinks || []}
              onChange={links => setForm({ ...form, theme: { ...form.theme, footerLinks: links } })}
            />
          </div>

          {/* Custom CSS */}
          <div className="card">
            <h3 style={{ marginBottom: 4 }}>Custom CSS</h3>
            <p style={{ color: '#636E72', fontSize: 13, marginBottom: 16 }}>
              Add custom CSS to further customize the form appearance. Applied inside the form container.
            </p>
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
            <h3 style={{ marginBottom: 4 }}>GDPR / Consent</h3>
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
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <IntegrationsPanel formId={id} />
      )}

      {/* Embed Tab */}
      {activeTab === 'embed' && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Embed Form</h3>
          <p style={{ color: '#636E72', marginBottom: 24, fontSize: 14 }}>
            Copy the code and paste it into your landing page.
          </p>

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
function StepEditor({ step, index, total, allSteps, expanded, onToggle, onChange, onChangeType, onMove, onRemove }) {
  const fieldDef = FIELD_TYPE_MAP[step.type];

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
        <span style={{ fontSize: 20 }}>{fieldDef?.icon || '📝'}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {index + 1}. {fieldDef?.label || step.type}
          </span>
          <div style={{ fontSize: 14, color: '#636E72', marginTop: 2 }}>
            {step.question || <em style={{ opacity: 0.5 }}>No question set</em>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button className="btn btn-sm btn-secondary" onClick={() => onMove(-1)} disabled={index === 0} title="Move up">&uarr;</button>
          <button className="btn btn-sm btn-secondary" onClick={() => onMove(1)} disabled={index === total - 1} title="Move down">&darr;</button>
          <button className="btn btn-sm btn-danger" onClick={onRemove}>Remove</button>
        </div>
        <span style={{ fontSize: 18, color: '#aaa', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ paddingTop: 16 }}>
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
                    border: step.type === ft.value ? '2px solid var(--primary, #6C5CE7)' : '2px solid #e0e0e0',
                    borderRadius: 10,
                    background: step.type === ft.value ? 'rgba(108,92,231,0.08)' : '#fafafa',
                    cursor: 'pointer', fontSize: 13, fontWeight: step.type === ft.value ? 700 : 500,
                    color: step.type === ft.value ? 'var(--primary, #6C5CE7)' : '#333',
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
            <div className="input-group" style={{ marginTop: 12 }}>
              <label>Options (one per line)</label>
              <textarea
                className="input"
                rows={4}
                value={(step.options || []).join('\n')}
                onChange={e => onChange({ options: e.target.value.split('\n').filter(Boolean) })}
                placeholder={"Option 1\nOption 2\nOption 3"}
              />
            </div>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={step.showCountry !== false} onChange={e => onChange({ showCountry: e.target.checked })} />
                Include country field
              </label>
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
        </div>
      )}
    </div>
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
  const previousSteps = allSteps.filter(s => s.id !== currentStepId);

  function toggle() {
    if (enabled) {
      onChange(null);
    } else {
      onChange({ field: previousSteps[0]?.id || '', op: 'equals', value: '' });
    }
  }

  if (previousSteps.length === 0) return null;

  return (
    <div style={{ marginTop: 16, padding: 14, background: '#fafafa', borderRadius: 10, border: '1px solid #eee' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Conditional Logic
      </label>
      {enabled && condition && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#636E72' }}>Show this step only if</span>
          <select className="input" value={condition.field || ''} onChange={e => onChange({ ...condition, field: e.target.value })} style={{ width: 'auto', minWidth: 140, padding: '6px 10px', fontSize: 13 }}>
            <option value="">-- Select field --</option>
            {previousSteps.map(s => (
              <option key={s.id} value={s.id}>{s.label || s.id}</option>
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
