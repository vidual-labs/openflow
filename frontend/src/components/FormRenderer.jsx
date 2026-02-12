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

export default function FormRenderer({ form, onSubmit, embedded = false }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [consentGiven, setConsentGiven] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState('forward');
  const containerRef = useRef(null);

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

  const themeVars = {
    '--form-primary': theme.primaryColor || '#6C5CE7',
    '--form-bg': theme.backgroundColor || '#FFFFFF',
    '--form-text': theme.textColor || '#2D3436',
    '--form-font': theme.fontFamily || 'inherit',
  };

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

  // GTM step tracking
  useEffect(() => {
    if (window.dataLayer && step) {
      window.dataLayer.push({
        event: 'openflow_step',
        formId: form.id,
        stepIndex: currentStep,
        stepId: step.id,
      });
    }
  }, [currentStep]);

  // Auto-advance for yes-no and image-select
  useEffect(() => {
    if (step && (step.type === 'yes-no' || step.type === 'image-select') && answers[step.id] !== undefined) {
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

      <div className="form-nav">
        <button className="form-nav-btn" onClick={prev} disabled={currentStep === 0}>
          &#8592;
        </button>
        <span className="form-step-count">{currentStep + 1} / {steps.length}</span>
        <button className="form-btn" onClick={next}>
          {isLastStep ? 'Submit' : 'Next'} &#8594;
        </button>
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
  const selectedIdx = options.findIndex(opt => (typeof opt === 'string' ? opt : opt.value) === value);

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (selectedIdx + 1) % options.length;
      const opt = options[next];
      onChange(typeof opt === 'string' ? opt : opt.value);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = selectedIdx <= 0 ? options.length - 1 : selectedIdx - 1;
      const opt = options[prev];
      onChange(typeof opt === 'string' ? opt : opt.value);
    }
  }

  return (
    <div className="form-options" tabIndex={0} onKeyDown={handleKeyDown}>
      {options.map((opt, i) => {
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const optLabel = typeof opt === 'string' ? opt : opt.label;
        return (
          <button key={i} className={`form-option ${value === optValue ? 'selected' : ''}`} onClick={() => onChange(optValue)}>
            <span className="option-key">{String.fromCharCode(65 + i)}</span>
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
  const [focusIdx, setFocusIdx] = useState(0);

  function toggle(optValue) {
    if (selected.includes(optValue)) {
      onChange(selected.filter(v => v !== optValue));
    } else {
      onChange([...selected, optValue]);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      setFocusIdx(prev => (prev + 1) % options.length);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocusIdx(prev => prev <= 0 ? options.length - 1 : prev - 1);
    } else if (e.key === ' ') {
      e.preventDefault();
      const opt = options[focusIdx];
      toggle(typeof opt === 'string' ? opt : opt.value);
    }
  }

  return (
    <div className="form-options" tabIndex={0} onKeyDown={handleKeyDown}>
      {options.map((opt, i) => {
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const optLabel = typeof opt === 'string' ? opt : opt.label;
        return (
          <button key={i} className={`form-option ${selected.includes(optValue) ? 'selected' : ''} ${focusIdx === i ? 'focused' : ''}`} onClick={() => toggle(optValue)}>
            <span className="option-key">{selected.includes(optValue) ? '✓' : String.fromCharCode(65 + i)}</span>
            {optLabel}
          </button>
        );
      })}
      <p className="option-hint">Multiple selections allowed &middot; Use arrow keys + space</p>
    </div>
  );
}

function YesNoInput({ step, value, onChange }) {
  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange('yes'); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange('no'); }
  }

  return (
    <div className="form-options form-yesno" tabIndex={0} onKeyDown={handleKeyDown}>
      <button className={`form-option ${value === 'yes' ? 'selected' : ''}`} onClick={() => onChange('yes')}>
        <span className="option-key">Y</span> Yes
      </button>
      <button className={`form-option ${value === 'no' ? 'selected' : ''}`} onClick={() => onChange('no')}>
        <span className="option-key">N</span> No
      </button>
    </div>
  );
}

function RatingInput({ step, value, onChange }) {
  const max = step.max || 5;

  function handleKeyDown(e) {
    const current = value || 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(current + 1, max));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(current - 1, 1));
    }
  }

  return (
    <div className="form-rating" tabIndex={0} onKeyDown={handleKeyDown}>
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
  const selectedIdx = options.findIndex(opt => (typeof opt === 'string' ? opt : opt.value) === value);
  const [focusIdx, setFocusIdx] = useState(selectedIdx >= 0 ? selectedIdx : 0);

  function handleKeyDown(e) {
    const cols = Math.min(options.length, 4); // approximate grid columns
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFocusIdx(prev => Math.min(prev + 1, options.length - 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocusIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx(prev => Math.min(prev + cols, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(prev => Math.max(prev - cols, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const opt = options[focusIdx];
      onChange(typeof opt === 'string' ? opt : opt.value);
    }
  }

  return (
    <div className="form-image-grid" tabIndex={0} onKeyDown={handleKeyDown}>
      {options.map((opt, i) => {
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const optLabel = typeof opt === 'string' ? opt : opt.label;
        const optIcon = typeof opt === 'object' ? opt.icon : null;
        const optImage = typeof opt === 'object' ? opt.image : null;
        return (
          <button
            key={i}
            className={`form-image-option ${value === optValue ? 'selected' : ''} ${focusIdx === i ? 'focused' : ''}`}
            onClick={() => onChange(optValue)}
          >
            {optImage ? (
              <img src={optImage} alt={optLabel} className="image-option-img" />
            ) : optIcon ? (
              <span className="image-option-icon">{optIcon}</span>
            ) : (
              <span className="image-option-icon">{String.fromCharCode(65 + i)}</span>
            )}
            <span className="image-option-label">{optLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
