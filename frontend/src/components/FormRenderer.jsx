import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import './FormRenderer.css';
import { LOCALES } from '../locales';

const LocaleContext = createContext(LOCALES.en);
function useLocale() { return useContext(LocaleContext); }

// Extract the highest number from a string like "51-100 guests" → 100, or "100+" → 100
function parseGuestCount(answer) {
  if (answer === undefined || answer === null || answer === '') return null;
  if (typeof answer === 'number') return answer;
  const nums = String(answer).match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums.map(Number));
}

// Filter select/multi-select options based on flat-rate pricing (e.g. 40€/person).
// Options with a maxBudget below (guestCount × rate) are hidden.
function applyPricingFilter(step, answers) {
  const pf = step.pricingFilter;
  if (!pf?.enabled || !pf.field || !pf.rate) return step;
  const guestCount = parseGuestCount(answers[pf.field]);
  if (guestCount === null) return step;
  const minRequired = guestCount * pf.rate;
  const filteredOptions = (step.options || []).filter(opt => {
    if (typeof opt === 'string') return true;
    return !opt.maxBudget || opt.maxBudget >= minRequired;
  });
  return { ...step, options: filteredOptions };
}

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

// Validate a single field's value. Returns an error string, or null if valid.
// Shared by normal steps and the sub-fields of a combined "group" step.
function validateField(field, value, locale) {
  const empty = value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
  if (field.required && empty) return locale.errorRequired;
  if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return locale.errorEmail;
  if (field.type === 'website' && value && !/^https?:\/\/.+\..+/.test(value)) return locale.errorUrl;
  if (field.type === 'consent' && field.required && !value) return locale.errorConsent;
  if ((field.type === 'address' || field.type === 'contact') && field.required) {
    const c = value || {};
    if (!c.street || !c.postalCode || !c.city) return locale.errorAddress;
  }
  return null;
}

// Renders the sub-fields of a combined ("group") step stacked vertically.
// Each sub-field keeps its own id, so answers stay keyed per field.
function GroupInput({ step, answers, setFieldAnswer }) {
  return (
    <div className="form-group-fields">
      {(step.fields || []).map((field, idx) => {
        const Field = FIELD_TYPES[field.type] || TextInput;
        const display = applyPricingFilter(field, answers);
        return (
          <div key={field.id} className="form-group-field" style={idx > 0 ? { marginTop: 24 } : undefined}>
            {field.label && <span className="step-label">{field.label}</span>}
            {field.question && <h3 className="step-question group-subquestion">{field.question}</h3>}
            {field.description && <p className="step-description">{field.description}</p>}
            <div className="step-field">
              <Field step={display} value={answers[field.id]} onChange={(v) => setFieldAnswer(field.id, v)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

// Lighten a hex color by a given amount (0-255)
function adjustColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0x00FF) + amount);
  const b = Math.min(255, (num & 0x0000FF) + amount);
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

const BG_SHAPES = { waves: 3, bubbles: 4, aurora: 3, particles: 6, flow: 4 };

export default function FormRenderer({ form, onSubmit, embedded = false }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [consentGiven, setConsentGiven] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState('forward');
  const containerRef = useRef(null);
  const trackedRef = useRef(false);
  // Always-current ref so auto-advance timer can check if user navigated away
  const currentStepRef = useRef(currentStep);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);

  const allSteps = form.steps || [];
  const theme = form.theme || {};
  const locale = LOCALES[theme.language] || LOCALES.en;

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
  const consentText = endScreen.consentText || locale.consentDefault;

  const buttonPosition = theme.buttonPosition || 'footer';
  const showEnterHint = !!theme.showEnterHint;
  const bgAnimation = theme.backgroundAnimation || 'none';

  const formBg = theme.backgroundColor || '#FFFFFF';
  const primaryColor = theme.primaryColor || '#6C5CE7';
  const themeVars = {
    '--form-primary': primaryColor,
    '--form-bg': formBg,
    '--form-text': theme.textColor || '#2D3436',
    '--form-font': theme.fontFamily || 'inherit',
    '--form-bg-accent': theme.accentColor || adjustColor(primaryColor, 40),
  };

  // Sync body background to form background so no dark-mode bleed-through
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = formBg;
    return () => { document.body.style.background = prev; };
  }, [formBg]);

  function setFieldAnswer(fieldId, value) {
    setAnswers(prev => ({ ...prev, [fieldId]: value }));
    setError('');
  }

  function setAnswer(value) {
    setFieldAnswer(step.id, value);
  }

  // A combined ("group") step validates each of its sub-fields; a normal step
  // validates itself.
  function stepFields(s) {
    return s.type === 'group' && Array.isArray(s.fields) ? s.fields : [s];
  }

  const next = useCallback(function next() {
    for (const field of stepFields(step)) {
      const err = validateField(field, answers[field.id], locale);
      if (err) {
        setError(err);
        return;
      }
    }
    // Check consent on last step
    if (isLastStep && consentRequired && !consentGiven) {
      setError(locale.errorConsentSubmit);
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
      setError(err.message || locale.errorSubmitFailed);
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

  const AUTO_ADVANCE_FIELDS = ['select', 'multi-select', 'yes-no', 'rating', 'image-select'];

  // Auto-advance for choice-based field types when answer is provided.
  // Capture the step index at schedule time and compare against the ref at
  // fire time so we don't advance if the user has already navigated away.
  useEffect(() => {
    if (step && answers[step.id] !== undefined && !theme?.disableAutoAdvance && AUTO_ADVANCE_FIELDS.includes(step.type)) {
      const stepAtSchedule = currentStep;
      const timer = setTimeout(() => {
        if (currentStepRef.current === stepAtSchedule) next();
      }, 400);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers[step?.id]]);

  if (submitted) {
    return (
      <LocaleContext.Provider value={locale}>
        <div className="form-renderer" style={themeVars} ref={containerRef}>
          <div className="form-end-screen slide-in-forward">
            <div className="end-icon">&#10003;</div>
            <h2>{endScreen.title || locale.thankYou}</h2>
            <p>{endScreen.message || locale.submittedMessage}</p>
            {endScreen.redirectUrl && (
              <a href={endScreen.redirectUrl} className="form-btn" style={{ marginTop: 24 }}>
                {locale.continueBtn}
              </a>
            )}
          </div>
        </div>
      </LocaleContext.Provider>
    );
  }

  if (!step) {
    return <div className="form-renderer" style={themeVars}><p>{locale.noQuestions}</p></div>;
  }

  const FieldComponent = FIELD_TYPES[step.type] || TextInput;

  // Flat-rate pricing filter: hide budget options that can't cover the minimum cost
  const displayStep = applyPricingFilter(step, answers);

  const footerLinks = (theme.footerLinks || []).filter(l => l.title && l.url);

  const enterHint = showEnterHint && step?.type !== 'textarea' ? (
    <span className="form-enter-hint">
      {locale.enterHintBefore}<kbd>Enter &#8629;</kbd>{locale.enterHintAfter}
    </span>
  ) : null;

  const nextButton = (
    <button className="form-btn" onClick={next}>
      {isLastStep ? (theme.submitButtonLabel || locale.submit) : (theme.nextButtonLabel || locale.next)} &#8594;
    </button>
  );

  return (
    <LocaleContext.Provider value={locale}>
    <div className={`form-renderer ${embedded ? 'embedded' : ''}`} style={themeVars} onKeyDown={handleKeyDown} ref={containerRef}>
      {/* Custom CSS */}
      {theme.customCss && <style>{theme.customCss}</style>}

      {/* Animated Background */}
      {bgAnimation !== 'none' && BG_SHAPES[bgAnimation] && (
        <div className={`form-bg-animation bg-${bgAnimation}`}>
          {Array.from({ length: BG_SHAPES[bgAnimation] }, (_, i) => <span key={i} />)}
        </div>
      )}

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
          {step.type === 'group' ? (
            <>
              <GroupInput step={step} answers={answers} setFieldAnswer={setFieldAnswer} />
              {(buttonPosition === 'below-input' || buttonPosition === 'inline') && (
                <div className={buttonPosition === 'below-input' ? 'form-below-input-actions' : 'form-inline-actions'}>
                  {nextButton}
                  {enterHint}
                </div>
              )}
            </>
          ) : (
            <>
              {step.label && <span className="step-label">{step.label}</span>}
              <h2 className="step-question">{step.question}</h2>
              {step.description && <p className="step-description">{step.description}</p>}

              <div className="step-field">
                <FieldComponent
                  step={displayStep}
                  value={answers[step.id]}
                  onChange={setAnswer}
                />
                {buttonPosition === 'below-input' && (
                  <div className="form-below-input-actions">
                    {nextButton}
                    {enterHint}
                  </div>
                )}
              </div>

              {/* Inline button (below input but after question) */}
              {buttonPosition === 'inline' && (
                <div className="form-inline-actions">
                  {nextButton}
                  {enterHint}
                </div>
              )}
            </>
          )}

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {buttonPosition === 'footer' && enterHint}
          {buttonPosition === 'footer' && nextButton}
          {(buttonPosition === 'inline' || buttonPosition === 'below-input') && <span />}
        </div>
      </div>
    </div>
    </LocaleContext.Provider>
  );
}

/* ========================
   Field Components
   ======================== */

function TextInput({ step, value, onChange }) {
  const locale = useLocale();
  return (
    <input className="form-input" type="text" placeholder={step.placeholder || locale.placeholderText} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function EmailInput({ step, value, onChange }) {
  const locale = useLocale();
  return (
    <input className="form-input" type="email" placeholder={step.placeholder || locale.placeholderEmail} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function PhoneInput({ step, value, onChange }) {
  const locale = useLocale();
  return (
    <input className="form-input" type="tel" placeholder={step.placeholder || locale.placeholderPhone} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function TextareaInput({ step, value, onChange }) {
  const locale = useLocale();
  return (
    <textarea className="form-input form-textarea" placeholder={step.placeholder || locale.placeholderText} value={value || ''} onChange={e => onChange(e.target.value)} rows={4} autoFocus />
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
        const optValue = typeof opt === 'string' ? opt : (opt.value ?? opt.label);
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
        const optValue = typeof opt === 'string' ? opt : (opt.value ?? opt.label);
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
  const locale = useLocale();
  return (
    <div className="form-options form-yesno">
      <button className={`form-option ${value === 'yes' ? 'selected' : ''}`} onClick={() => onChange('yes')}>
        {locale.yes}
      </button>
      <button className={`form-option ${value === 'no' ? 'selected' : ''}`} onClick={() => onChange('no')}>
        {locale.no}
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
  const locale = useLocale();
  return (
    <input className="form-input" type="url" placeholder={step.placeholder || locale.placeholderUrl} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
  );
}

function AddressInput({ step, value, onChange }) {
  const locale = useLocale();
  const data = value || {};
  function update(field, val) {
    onChange({ ...data, [field]: val });
  }
  const customFields = step.customFields || [];
  const al = step.addressLabels || {};
  return (
    <div className="form-address">
      <input className="form-input" type="text" placeholder={al.street || locale.addressStreet} value={data.street || ''} onChange={e => update('street', e.target.value)} autoFocus />
      <div className="form-address-row">
        <input className="form-input" type="text" placeholder={al.postalCode || locale.addressPostal} value={data.postalCode || ''} onChange={e => update('postalCode', e.target.value)} />
        <input className="form-input" type="text" placeholder={al.city || locale.addressCity} value={data.city || ''} onChange={e => update('city', e.target.value)} />
      </div>
      {step.showCountry !== false && (
        <input className="form-input" type="text" placeholder={al.country || locale.addressCountry} value={data.country || ''} onChange={e => update('country', e.target.value)} />
      )}
      {customFields.map((field, idx) => (
        <div key={field.id || idx} style={{ marginTop: 12 }}>
          {field.type === 'text' && (
            <>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#555' }}>{field.label}</label>
              <input className="form-input" type="text" value={data[field.id] || ''} onChange={e => update(field.id, e.target.value)} />
            </>
          )}
          {field.type === 'dropdown' && (
            <>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#555' }}>{field.label}</label>
              <select className="form-input" value={data[field.id] || ''} onChange={e => update(field.id, e.target.value)}>
                <option value="">{locale.addressSelect}</option>
                {(field.options || '').split(',').map((opt, i) => (
                  <option key={i} value={opt.trim()}>{opt.trim()}</option>
                ))}
              </select>
            </>
          )}
          {field.type === 'radio' && (
            <>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#555' }}>{field.label}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(field.options || '').split(',').map((opt, i) => (
                  <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                    <input type="radio" name={field.id} value={opt.trim()} checked={data[field.id] === opt.trim()} onChange={e => update(field.id, e.target.value)} />
                    {opt.trim()}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ConsentInput({ step, value, onChange }) {
  const locale = useLocale();
  return (
    <label className="form-consent">
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
      <span className="consent-text">{step.consentText || locale.consentDefault}</span>
    </label>
  );
}

function FileUploadInput({ step, value, onChange }) {
  const locale = useLocale();
  const fileRef = useRef();
  const maxSize = (step.maxSizeMB || 10) * 1024 * 1024;
  const [fileName, setFileName] = useState(value?.name || '');
  const [error, setError] = useState('');

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (file.size > maxSize) {
      setError(locale.fileTooLarge(step.maxSizeMB || 10));
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
            <span>{locale.fileUploadPrompt}</span>
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
