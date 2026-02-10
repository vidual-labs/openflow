import React, { useState, useEffect, useRef } from 'react';
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
  contact: ContactInput,
  consent: ConsentInput,
  'image-select': ImageSelectInput,
};

export default function FormRenderer({ form, onSubmit, embedded = false }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState('forward');
  const containerRef = useRef(null);

  const steps = form.steps || [];
  const progress = steps.length > 0 ? ((currentStep + 1) / steps.length) * 100 : 0;
  const step = steps[currentStep];
  const theme = form.theme || {};

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

  function next() {
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
    if (step.type === 'contact' && step.required) {
      const c = answers[step.id] || {};
      if (!c.name || !c.email) {
        setError('Please fill in at least name and email.');
        return;
      }
    }
    if (currentStep < steps.length - 1) {
      setDirection('forward');
      setCurrentStep(prev => prev + 1);
      setError('');
    } else {
      handleSubmit();
    }
  }

  function prev() {
    if (currentStep > 0) {
      setDirection('back');
      setCurrentStep(prev => prev - 1);
      setError('');
    }
  }

  async function handleSubmit() {
    try {
      await onSubmit(answers);
      setSubmitted(true);
      // GTM event
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

  // Auto-advance for yes-no, consent, and image-select
  useEffect(() => {
    if (step && (step.type === 'yes-no' || step.type === 'image-select') && answers[step.id] !== undefined) {
      const timer = setTimeout(() => next(), 400);
      return () => clearTimeout(timer);
    }
  }, [answers[step?.id]]);

  if (submitted) {
    const endScreen = form.end_screen || {};
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

  return (
    <div className={`form-renderer ${embedded ? 'embedded' : ''}`} style={themeVars} onKeyDown={handleKeyDown} ref={containerRef}>
      {/* Progress bar */}
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

          {error && <p className="step-error">{error}</p>}
        </div>
      </div>

      <div className="form-nav">
        <button className="form-nav-btn" onClick={prev} disabled={currentStep === 0}>
          &#8592;
        </button>
        <span className="form-step-count">{currentStep + 1} / {steps.length}</span>
        <button className="form-btn" onClick={next}>
          {currentStep === steps.length - 1 ? 'Submit' : 'Next'} &#8594;
        </button>
      </div>
    </div>
  );
}

/* Field Components */

function TextInput({ step, value, onChange }) {
  return (
    <input
      className="form-input"
      type="text"
      placeholder={step.placeholder || 'Type your answer...'}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      autoFocus
    />
  );
}

function EmailInput({ step, value, onChange }) {
  return (
    <input
      className="form-input"
      type="email"
      placeholder={step.placeholder || 'name@example.com'}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      autoFocus
    />
  );
}

function PhoneInput({ step, value, onChange }) {
  return (
    <input
      className="form-input"
      type="tel"
      placeholder={step.placeholder || '+1 234 567890'}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      autoFocus
    />
  );
}

function TextareaInput({ step, value, onChange }) {
  return (
    <textarea
      className="form-input form-textarea"
      placeholder={step.placeholder || 'Type your answer...'}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      rows={4}
      autoFocus
    />
  );
}

function NumberInput({ step, value, onChange }) {
  return (
    <input
      className="form-input"
      type="number"
      placeholder={step.placeholder || '0'}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      min={step.min}
      max={step.max}
      autoFocus
    />
  );
}

function DateInput({ step, value, onChange }) {
  return (
    <input
      className="form-input"
      type="date"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      autoFocus
    />
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
          <button
            key={i}
            className={`form-option ${value === optValue ? 'selected' : ''}`}
            onClick={() => onChange(optValue)}
          >
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
          <button
            key={i}
            className={`form-option ${selected.includes(optValue) ? 'selected' : ''}`}
            onClick={() => toggle(optValue)}
          >
            <span className="option-key">{selected.includes(optValue) ? '✓' : String.fromCharCode(65 + i)}</span>
            {optLabel}
          </button>
        );
      })}
      <p className="option-hint">Multiple selections allowed</p>
    </div>
  );
}

function YesNoInput({ step, value, onChange }) {
  return (
    <div className="form-options form-yesno">
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
  return (
    <div className="form-rating">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button
          key={n}
          className={`rating-star ${value >= n ? 'active' : ''}`}
          onClick={() => onChange(n)}
        >
          {value >= n ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

function WebsiteInput({ step, value, onChange }) {
  return (
    <input
      className="form-input"
      type="url"
      placeholder={step.placeholder || 'https://example.com'}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      autoFocus
    />
  );
}

function ContactInput({ step, value, onChange }) {
  const data = value || {};
  function update(field, val) {
    onChange({ ...data, [field]: val });
  }
  return (
    <div className="form-contact">
      <input className="form-input" type="text" placeholder="Full name *" value={data.name || ''} onChange={e => update('name', e.target.value)} autoFocus />
      <input className="form-input" type="email" placeholder="Email address *" value={data.email || ''} onChange={e => update('email', e.target.value)} />
      <input className="form-input" type="tel" placeholder="Phone (optional)" value={data.phone || ''} onChange={e => update('phone', e.target.value)} />
      <input className="form-input" type="text" placeholder="Company (optional)" value={data.company || ''} onChange={e => update('company', e.target.value)} />
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
