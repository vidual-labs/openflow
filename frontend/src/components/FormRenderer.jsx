import React, { useState, useEffect, useRef, useCallback } from 'react';
import './FormRenderer.css';

const FIELD_TYPES = {
  text: TextInput,
  email: EmailInput,
  phone: PhoneInput,
  textarea: TextareaInput,
  select: SelectInput,
  'multi-select': MultiSelectInput,
  'yes-no': YesNoInput,
  rating: RatingInput,
  number: NumberInput,
  date: DateInput,
  website: WebsiteInput,
  address: AddressInput,
  contact: AddressInput, // backward compat
  consent: ConsentInput, // backward compat for old forms
  'image-select': ImageSelectInput,
  'file-upload': FileUploadInput,
};

// Generate a unique session ID for analytics
function getSessionId() {
  let sid = sessionStorage.getItem('of_sid');
  if (!sid) {
    sid = Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessionStorage.setItem('of_sid', sid);
  }
  return sid;
}

function trackEvent(formId, eventType, meta = {}) {
  try {
    const baseUrl = window.__OPENFLOW_BASE_URL__ || '';
    const payload = JSON.stringify({ formId, event: eventType, sessionId: getSessionId(), ...meta });
    const blob = new Blob([payload], { type: 'application/json' });
    const sent = navigator.sendBeacon?.(`${baseUrl}/api/public/track`, blob);
    if (!sent) {
      fetch(`${baseUrl}/api/public/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {}
}

export default function FormRenderer({ form, onSubmit, embedded = false }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [consentGiven, setConsentGiven] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState('forward');
  const containerRef = useRef(null);
  const trackedRef = useRef(false);

  const allSteps = form.steps || [];
  const theme = form.theme || {};

  // Conditional logic: filter steps based on answers
  const steps = allSteps.filter(s => {
    if (!s.condition) return true;
    const { field, op, value } = s.condition;
    if (!field) return true;
    const ans = answers[field];
    if (ans === undefined || ans === null) return true; // show if answer not given yet
    const ansStr = String(ans);
    switch (op) {
      case 'equals': return ansStr === value;
      case 'not_equals': return ansStr !== value;
      case 'contains': return ansStr.toLowerCase().includes((value || '').toLowerCase());
      case 'is_set': return ans !== '' && ans !== false;
      case 'is_not_set': return ans === '' || ans === false || ans === undefined;
      default: return true;
    }
  });

  const progress = steps.length > 0 ? ((currentStep + 1) / steps.length) * 100 : 0;
  const step = steps[currentStep];
  const endScreen = form.end_screen || {};
  const isLastStep = currentStep === steps.length - 1;
  const consentRequired = !!endScreen.consentEnabled;
  const consentText = endScreen.consentText || 'I agree to the privacy policy and terms of service.';

  const formBg = theme.backgroundColor || '#FFFFFF';
  const themeVars = {
    '--form-primary': theme.primaryColor || '#6C5CE7',
    '--form-bg': formBg,
    '--form-text': theme.textColor || '#2D3436',
    '--form-font': theme.fontFamily || 'inherit',
  };

  // Sync body background to form background so no dark-mode bleed-through
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = formBg;
    return () => { document.body.style.background = prev; };
  }, [formBg]);

  function setAnswer(value) {
    setAnswers(prev => ({ ...prev, [step.id]: value }));
    setError('');
  }

  function canProceed() {
    if (!step) return false;
    if (!step.required) return true;
    const val = answers[step.id];
    if (val === undefined || val === null || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  }

  const next = useCallback(function next() {
    if (!canProceed()) {
      setError('Please answer this question.');
      return;
    }
    if (step.type === 'email' && answers[step.id] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers[step.id])) {
      setError('Please enter a valid email address.');
      return;
    }
    if (step.type === 'website' && answers[step.id] && !/^https?:\/\/.+\..+/.test(answers[step.id])) {
      setError('Please enter a valid URL (starting with http:// or https://).');
      return;
    }
    if (step.type === 'consent' && step.required && !answers[step.id]) {
      setError('You must agree to continue.');
      return;
    }
    if ((step.type === 'address' || step.type === 'contact') && step.required) {
      const c = answers[step.id] || {};
      if (!c.street || !c.postalCode || !c.city) {
        setError('Please fill in street, postal code, and city.');
        return;
      }
    }
    // Check consent on last step
    if (isLastStep && consentRequired && !consentGiven) {
      setError('You must agree to the consent to submit.');
      return;
    }
    if (currentStep < steps.length - 1) {
      setDirection('forward');
      setCurrentStep(prev => prev + 1);
      setError('');
    } else {
      handleSubmit();
    }
  });

  function prev() {
    if (currentStep > 0) {
      setDirection('back');
      setCurrentStep(prev => prev - 1);
      setError('');
    }
  }

  async function handleSubmit() {
    const submitData = { ...answers };
    if (consentRequired) {
      submitData._consent = consentGiven;
    }
    try {
      await onSubmit(submitData);
      setSubmitted(true);
      trackEvent(form.id, 'complete');
      if (window.dataLayer) {
        window.dataLayer.push({
          event: 'openflow_submit',
          formId: form.id,
          formTitle: form.title,
        });
      }
    } catch (err) {
      setError(err.message || 'Submission failed');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && step?.type !== 'textarea') {
      e.preventDefault();
      next();
    }
  }

  // Track form view on mount
  useEffect(() => {
    if (!trackedRef.current && form?.id) {
      trackedRef.current = true;
      trackEvent(form.id, 'view');
      trackEvent(form.id, 'start');
    }
  }, [form?.id]);

  // GTM step tracking + analytics
  useEffect(() => {
    if (step) {
      trackEvent(form.id, 'step', { stepIndex: currentStep, stepId: step.id });
      if (window.dataLayer) {
        window.dataLayer.push({
          event: 'openflow_step',
          formId: form.id,
          stepIndex: currentStep,
          stepId: step.id,
        });
      }
    }
  }, [currentStep]);

  // Auto-advance for single-choice fields
  useEffect(() => {
    if (step && (step.type === 'yes-no' || step.type === 'image-select' || step.type === 'select') && answers[step.id] !== undefined) {
      const timer = setTimeout(() => next(), 400);
      return () => clearTimeout(timer);
    }
  }, [answers[step?.id]]);

  if (submitted) {
    return (
      <div className="form-renderer" style={themeVars} ref={containerRef}>
        <div className="form-end-screen slide-in-forward">
          <div className="end-icon">&#10003;</div>
          <h2>{endScreen.title || 'Thank you!'}</h2>
          <p>{endScreen.message || 'Your responses have been submitted successfully.'}</p>
          {endScreen.redirectUrl && (
            <a href={endScreen.redirectUrl} className="form-btn" style={{ marginTop: 24 }}>
              Continue
            </a>
          )}
        </div>
      </div>
    );
  }

  if (!step) {
    return <div className="form-renderer" style={themeVars}><p>No questions configured.</p></div>;
  }

  const FieldComponent = FIELD_TYPES[step.type] || TextInput;

  const footerLinks = (theme.footerLinks || []).filter(l => l.title && l.url);

  return (
    <div className={`form-renderer ${embedded ? 'embedded' : ''}`} style={themeVars} onKeyDown={handleKeyDown} ref={containerRef}>
      {/* Custom CSS */}
      {theme.customCss && <style>{theme.customCss}</style>}

      {/* Header / Landing Page */}
      {(theme.logoUrl || theme.headline) && (
        <div className="form-header" style={{ textAlign: theme.logoPosition === 'left' ? 'left' : 'center' }}>
          {theme.logoUrl && <img src={theme.logoUrl} alt="" className="form-logo" />}
          {theme.headline && <h1 className="form-headline">{theme.headline}</h1>}
          {theme.subline && <p className="form-subline">{theme.subline}</p>}
        </div>
      )}

      <div className="form-progress">
        <div className="form-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <div className="form-content">
        <div className={`form-step ${direction === 'forward' ? 'slide-in-forward' : 'slide-in-back'}`} key={currentStep}>
          {step.label && <span className="step-label">{step.label}</span>}
          <h2 className="step-question">{step.question}</h2>
          {step.description && <p className="step-description">{step.description}</p>}

          <div className="step-field">
            <FieldComponent
              step={step}
              value={answers[step.id]}
              onChange={setAnswer}
            />
          </div>

          {/* GDPR consent on last step */}
          {isLastStep && consentRequired && (
            <label className="form-consent" style={{ marginTop: 24 }}>
              <input type="checkbox" checked={consentGiven} onChange={e => { setConsentGiven(e.target.checked); setError(''); }} />
              <span className="consent-text">{consentText}</span>
            </label>
          )}

          {error && <p className="step-error">{error}</p>}
        </div>
      </div>

      {/* Footer Links */}
      {footerLinks.length > 0 && (
        <div className="form-footer">
          {footerLinks.map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="form-footer-link">
              {link.title}
            </a>
          ))}
        </div>
      )}

      <div className="form-nav">
        <button className="form-nav-btn" onClick={prev} disabled={currentStep === 0}>
          &#8592;
        </button>
        <span className="form-step-count">{currentStep + 1} / {steps.length}</span>
        <button className="form-btn" onClick={next}>
          {isLastStep ? 'Submit' : 'Next'} &#8594;
        </button>
      </div>
    </div>
  );
}

/* ========================
   Field Components
   ======================== */

function TextInput({ step, value, onChange }) {
  return (
    <input className="form-input" type="text" placeholder={step.placeholder || 'Type your answer...'} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function EmailInput({ step, value, onChange }) {
  return (
    <input className="form-input" type="email" placeholder={step.placeholder || 'name@example.com'} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function PhoneInput({ step, value, onChange }) {
  return (
    <input className="form-input" type="tel" placeholder={step.placeholder || '+1 234 567890'} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function TextareaInput({ step, value, onChange }) {
  return (
    <textarea className="form-input form-textarea" placeholder={step.placeholder || 'Type your answer...'} value={value || ''} onChange={e => onChange(e.target.value)} rows={4} autoFocus />
  );
}

function NumberInput({ step, value, onChange }) {
  return (
    <input className="form-input" type="number" placeholder={step.placeholder || '0'} value={value || ''} onChange={e => onChange(e.target.value)} min={step.min} max={step.max} autoFocus />
  );
}

function DateInput({ step, value, onChange }) {
  return (
    <input className="form-input" type="date" value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function SelectInput({ step, value, onChange }) {
  const options = step.options || [];
  return (
    <div className="form-options">
      {options.map((opt, i) => {
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const optLabel = typeof opt === 'string' ? opt : opt.label;
        return (
          <button key={i} className={`form-option ${value === optValue ? 'selected' : ''}`} onClick={() => onChange(optValue)}>
            {optLabel}
          </button>
        );
      })}
    </div>
  );
}

function MultiSelectInput({ step, value, onChange }) {
  const selected = value || [];
  const options = step.options || [];

  function toggle(optValue) {
    if (selected.includes(optValue)) {
      onChange(selected.filter(v => v !== optValue));
    } else {
      onChange([...selected, optValue]);
    }
  }

  return (
    <div className="form-options">
      {options.map((opt, i) => {
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const optLabel = typeof opt === 'string' ? opt : opt.label;
        return (
          <button key={i} className={`form-option ${selected.includes(optValue) ? 'selected' : ''}`} onClick={() => toggle(optValue)}>
            <span className="option-key">{selected.includes(optValue) ? '✓' : ''}</span>
            {optLabel}
          </button>
        );
      })}
    </div>
  );
}

function YesNoInput({ step, value, onChange }) {
  return (
    <div className="form-options form-yesno">
      <button className={`form-option ${value === 'yes' ? 'selected' : ''}`} onClick={() => onChange('yes')}>
        Yes
      </button>
      <button className={`form-option ${value === 'no' ? 'selected' : ''}`} onClick={() => onChange('no')}>
        No
      </button>
    </div>
  );
}

function RatingInput({ step, value, onChange }) {
  const max = step.max || 5;
  return (
    <div className="form-rating">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button key={n} className={`rating-star ${value >= n ? 'active' : ''}`} onClick={() => onChange(n)}>
          {value >= n ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

function WebsiteInput({ step, value, onChange }) {
  return (
    <input className="form-input" type="url" placeholder={step.placeholder || 'https://example.com'} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function AddressInput({ step, value, onChange }) {
  const data = value || {};
  function update(field, val) {
    onChange({ ...data, [field]: val });
  }
  return (
    <div className="form-address">
      <input className="form-input" type="text" placeholder="Street and house number *" value={data.street || ''} onChange={e => update('street', e.target.value)} autoFocus />
      <div className="form-address-row">
        <input className="form-input" type="text" placeholder="Postal code *" value={data.postalCode || ''} onChange={e => update('postalCode', e.target.value)} />
        <input className="form-input" type="text" placeholder="City *" value={data.city || ''} onChange={e => update('city', e.target.value)} />
      </div>
      {step.showCountry !== false && (
        <input className="form-input" type="text" placeholder="Country (optional)" value={data.country || ''} onChange={e => update('country', e.target.value)} />
      )}
    </div>
  );
}

function ConsentInput({ step, value, onChange }) {
  return (
    <label className="form-consent">
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
      <span className="consent-text">{step.consentText || 'I agree to the privacy policy and terms of service.'}</span>
    </label>
  );
}

function FileUploadInput({ step, value, onChange }) {
  const fileRef = useRef();
  const maxSize = (step.maxSizeMB || 10) * 1024 * 1024;
  const [fileName, setFileName] = useState(value?.name || '');
  const [error, setError] = useState('');

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (file.size > maxSize) {
      setError(`File too large (max ${step.maxSizeMB || 10} MB)`);
      return;
    }
    setFileName(file.name);
    // Convert to base64 for storage
    const reader = new FileReader();
    reader.onload = () => {
      onChange({ name: file.name, type: file.type, size: file.size, data: reader.result });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="form-file-upload">
      <div
        className={`file-dropzone ${value ? 'has-file' : ''}`}
        onClick={() => fileRef.current?.click()}
      >
        {value ? (
          <>
            <span className="file-icon">&#128206;</span>
            <span className="file-name">{fileName}</span>
            <span className="file-size">({(value.size / 1024).toFixed(0)} KB)</span>
          </>
        ) : (
          <>
            <span className="file-icon">&#128193;</span>
            <span>Click to upload or drag & drop</span>
            <span className="file-hint">{step.accept || '.pdf,.jpg,.png'} &middot; Max {step.maxSizeMB || 10} MB</span>
          </>
        )}
      </div>
      <input ref={fileRef} type="file" accept={step.accept || '*'} onChange={handleFile} style={{ display: 'none' }} />
      {error && <p className="step-error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

function ImageSelectInput({ step, value, onChange }) {
  const options = step.options || [];
  return (
    <div className="form-image-grid">
      {options.map((opt, i) => {
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const optLabel = typeof opt === 'string' ? opt : opt.label;
        const optIcon = typeof opt === 'object' ? opt.icon : null;
        const optImage = typeof opt === 'object' ? opt.image : null;
        return (
          <button
            key={i}
            className={`form-image-option ${value === optValue ? 'selected' : ''}`}
            onClick={() => onChange(optValue)}
          >
            {optImage ? (
              <img src={optImage} alt={optLabel} className="image-option-img" />
            ) : optIcon ? (
              <span className="image-option-icon">{optIcon}</span>
            ) : null}
            <span className="image-option-label">{optLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
