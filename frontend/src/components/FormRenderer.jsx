import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import './FormRenderer.css';
import { LOCALES } from '../locales';
import { flattenFields } from '../utils/steps';

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
  'date-timeslot': DateTimeslotInput,
  website: WebsiteInput,
  address: AddressInput,
  contact: AddressInput, // backward compat
  consent: ConsentInput, // backward compat for old forms
  'image-select': ImageSelectInput,
  'file-upload': FileUploadInput,
};

// A date range is stored as one plain string, "2026-08-10 – 2026-08-14". Keeping it a
// string means CSV export, webhooks, the e-mail table, Google Sheets and the lodgely
// connector need no special handling — an object would reach them as "[object Object]".
// A single day, and a range whose end isn't picked yet, stay a bare "2026-08-10".
const DATE_RANGE_SEPARATOR = ' – ';

export function formatDateRange(start, end) {
  if (!start) return '';
  return end ? `${start}${DATE_RANGE_SEPARATOR}${end}` : start;
}

export function parseDateValue(value) {
  const [start = '', end = ''] = String(value || '').split(DATE_RANGE_SEPARATOR);
  return { start, end };
}

// A date + timeslot answer is stored the same way, for the same reason: a plain
// string works everywhere downstream with no special-casing. "2026-09-02 09:30"
// standalone, or "2026-09-02 09:30 Europe/Berlin" when the slot came from a
// connected calon instance, whose timezone is worth keeping unambiguous.
export function formatDateTimeslot(date, time, timezone) {
  if (!date || !time) return date || '';
  return timezone ? `${date} ${time} ${timezone}` : `${date} ${time}`;
}

export function parseDateTimeslotValue(value) {
  const [date = '', time = '', timezone = ''] = String(value || '').split(' ');
  return { date, time, timezone };
}

// Empty string, null, undefined and unparseable text all mean "no number here"; only a
// real, finite number comes back. Notably 0 survives, where a falsy check would drop it.
function toNumberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Seed the answers state from the fields' configured default values, so a prefilled
// number is visible on arrival, is submitted even if the visitor never touches the
// step, and is immediately available to the pricing filter and conditional logic.
function initialAnswers(steps) {
  const seeded = {};
  for (const field of flattenFields(steps)) {
    const preset = field?.type === 'number' ? toNumberOrNull(field.defaultValue) : null;
    if (preset !== null) seeded[field.id] = String(preset);
  }
  return seeded;
}

// Validate a single field's value. Returns an error string, or null if valid.
// Shared by normal steps and the sub-fields of a combined "group" step.
function validateField(field, value, locale) {
  const empty = value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
  if (field.required && empty) return locale.errorRequired;
  if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return locale.errorEmail;
  if (field.type === 'website' && value && !/^https?:\/\/.+\..+/.test(value)) return locale.errorUrl;
  if (field.type === 'consent' && field.required && !value) return locale.errorConsent;
  // A half-picked range ("2026-08-10" with no end) is a valid-looking answer that isn't
  // finished, so it has to be caught on optional steps too — `required` never sees it.
  if (field.type === 'date' && field.dateMode === 'range' && value && !parseDateValue(value).end) {
    return locale.errorDateRangeEnd;
  }
  // A date picked with no time yet is a valid-looking, non-empty answer, so — like
  // an unfinished date range above — this has to be caught even on optional steps.
  if (field.type === 'date-timeslot' && value && !parseDateTimeslotValue(value).time) {
    return locale.errorDateTimeslotTime;
  }
  if ((field.type === 'address' || field.type === 'contact') && field.required) {
    const c = value || {};
    if (!c.street || !c.postalCode || !c.city) return locale.errorAddress;
  }
  return null;
}

// Renders the sub-fields of a combined ("group") step stacked vertically.
// Each sub-field keeps its own id, so answers stay keyed per field.
function GroupInput({ step, answers, setFieldAnswer, formSlug }) {
  return (
    <div className="form-group-fields">
      {(step.fields || []).map((field, idx) => {
        const Field = FIELD_TYPES[field.type] || TextInput;
        const display = applyPricingFilter(field, answers);
        const questionId = `step-question-${field.id}`;
        return (
          <div key={field.id} className="form-group-field" style={idx > 0 ? { marginTop: 24 } : undefined}>
            {field.label && <span className="step-label">{field.label}</span>}
            {field.question && <h3 className="step-question group-subquestion" id={questionId}>{field.question}</h3>}
            {field.description && <p className="step-description">{field.description}</p>}
            <div className="step-field" role="group" aria-labelledby={field.question ? questionId : undefined}>
              <Field step={display} value={answers[field.id]} onChange={(v) => setFieldAnswer(field.id, v)} formSlug={formSlug} />
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

// "#0A0A0A" / "#eee" → "10, 10, 10". Powers the --form-text-rgb variable, which the
// stylesheet mixes at various alphas for placeholders, borders and muted labels. Those
// tones used to be hardcoded black, so they vanished on dark themes; deriving them from
// the theme's text color keeps them readable whatever background the form uses.
export function toRgbTriplet(hex, fallback = '45, 52, 54') {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  const num = parseInt(h, 16);
  return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}

const BG_SHAPES = { waves: 3, bubbles: 4, aurora: 3, particles: 6, flow: 4 };

// Id and type of the synthetic consent step appended after the last question when
// the form requires GDPR consent. It is not a configurable field, so it can never
// collide with a nanoid field id, and its answer lives outside `answers`.
export const CONSENT_STEP_ID = '__consent__';

export default function FormRenderer({ form, onSubmit, embedded = false }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState(() => initialAnswers(form.steps));
  const [consentGiven, setConsentGiven] = useState(false);
  // Inline consent is a two-press flow: the first Enter confirms the last answer,
  // the second one agrees. This marks that the first has happened, so the consent
  // is never carried along by the keystroke that finished the question.
  const [answerConfirmed, setAnswerConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState('forward');
  const containerRef = useRef(null);
  const trackedRef = useRef(false);
  const submittingRef = useRef(false);
  // Always-current ref so auto-advance timer can check if user navigated away
  const currentStepRef = useRef(currentStep);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);

  const allSteps = form.steps || [];
  const theme = form.theme || {};
  const locale = LOCALES[theme.language] || LOCALES.en;
  const endScreen = form.end_screen || {};
  const consentRequired = !!endScreen.consentEnabled;
  const consentText = endScreen.consentText || locale.consentDefault;
  // Where the consent is asked: on the last question step ("inline", the default —
  // one page, one extra Enter), or as a step of its own after it.
  const consentAsStep = consentRequired && endScreen.consentMode === 'step';
  const consentInline = consentRequired && !consentAsStep;

  // Conditional logic: filter steps based on answers
  const questionSteps = allSteps.filter(s => {
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

  // In "own step" mode the consent gets a step of its own at the end of the flow.
  // Inline mode keeps it on the last question step instead, so answering the last
  // field and agreeing happen on one page.
  const steps = consentAsStep
    ? [...questionSteps, { id: CONSENT_STEP_ID, type: CONSENT_STEP_ID, question: endScreen.consentHeadline || locale.consentStepQuestion }]
    : questionSteps;

  const progress = steps.length > 0 ? ((currentStep + 1) / steps.length) * 100 : 0;
  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const isConsentStep = !!step && step.id === CONSENT_STEP_ID;

  const buttonPosition = theme.buttonPosition || 'footer';
  const showEnterHint = !!theme.showEnterHint;
  const bgAnimation = theme.backgroundAnimation || 'none';

  const formBg = theme.backgroundColor || '#FFFFFF';
  const primaryColor = theme.primaryColor || '#6C5CE7';
  const textColor = theme.textColor || '#2D3436';
  const themeVars = {
    '--form-primary': primaryColor,
    '--form-primary-rgb': toRgbTriplet(primaryColor, '108, 92, 231'),
    '--form-bg': formBg,
    '--form-text': textColor,
    '--form-text-rgb': toRgbTriplet(textColor),
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
    // Editing an answer takes the confirmation back: the hint returns to the field
    // until the visitor confirms what they now wrote.
    setAnswerConfirmed(false);
  }

  function setAnswer(value) {
    setFieldAnswer(step.id, value);
  }

  // A combined ("group") step validates each of its sub-fields; a normal step
  // validates itself.
  function stepFields(s) {
    return s.type === 'group' && Array.isArray(s.fields) ? s.fields : [s];
  }

  // The step's own answers, checked without touching state — `next` uses it to
  // refuse an unfinished step, the inline consent hint to know the visitor has
  // reached the point where one more Enter finishes the form.
  function stepValidationError(s) {
    for (const field of stepFields(s)) {
      const err = validateField(field, answers[field.id], locale);
      if (err) return err;
    }
    // Combined step with "require at least one": at least one sub-field must be filled.
    if (s.type === 'group' && s.requireOne) {
      const anyFilled = (s.fields || []).some(f => {
        const v = answers[f.id];
        return !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
      });
      if (!anyFilled) return locale.errorRequireOne;
    }
    return null;
  }

  // Whether Enter would carry the visitor onwards from here. Until it would, a hint
  // saying so is a lie — Enter reports what is missing instead — so every hint on
  // the step waits for this.
  const stepReady = !!step && !stepValidationError(step);

  const showInlineConsent = consentInline && isLastStep;
  const inlineConsentReady = showInlineConsent && stepReady;
  // The second half of the inline flow: the answer is in and confirmed (or the box
  // was ticked by hand), so the hint has moved down to the checkbox and the next
  // Enter is the agreement itself — nothing else.
  const consentAwaited = inlineConsentReady && (answerConfirmed || consentGiven);

  // `opts.agree` marks a keystroke as the affirmative act the consent asks for:
  // Enter ticks the box and submits, where the Submit button still wants the box
  // ticked first. Called straight from onClick too, where the argument is an event.
  const next = useCallback(function next(opts) {
    const agree = opts?.agree === true;
    // The consent step has no field to validate — it is agreed to or it isn't.
    if (isConsentStep) {
      if (!consentGiven && !agree) {
        setError(locale.errorConsentSubmit);
        return;
      }
      setConsentGiven(true);
      handleSubmit(true);
      return;
    }
    const err = stepValidationError(step);
    if (err) {
      setError(err);
      return;
    }
    // Inline consent sits under the last step's field, and reaching it takes two
    // presses: consent has to be a deliberate act of its own, never something the
    // keystroke that finished the last answer carries along with it.
    if (isLastStep && consentInline) {
      // Box already ticked — by hand, or by the Enter that agreed a moment ago.
      if (consentGiven) {
        handleSubmit(true);
        return;
      }
      // First press: the answer is accepted and the hint moves down to the
      // checkbox. Nothing is agreed to and nothing is sent yet.
      if (!answerConfirmed) {
        setAnswerConfirmed(true);
        // The Submit button is not an agreement, so it still says what is missing —
        // now with the hint underneath the box pointing at the way to give it.
        if (!agree) setError(locale.errorConsentSubmit);
        return;
      }
      // Second press, with the answer already confirmed: this one is the consent.
      if (!agree) {
        setError(locale.errorConsentSubmit);
        return;
      }
      setConsentGiven(true);
      handleSubmit(true);
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

  // `consentOverride` covers the Enter shortcut, which agrees and submits in one
  // keystroke: the state update it triggers isn't visible to this call yet.
  async function handleSubmit(consentOverride) {
    // A held-down or double-tapped Enter must not post the form twice.
    if (submittingRef.current) return;
    submittingRef.current = true;
    const submitData = { ...answers };
    if (consentRequired) {
      submitData._consent = consentOverride === undefined ? consentGiven : consentOverride;
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
      // Failed sends have to stay retryable.
      submittingRef.current = false;
      setError(err.message || locale.errorSubmitFailed);
    }
  }

  // Enter is the affirmative act wherever the consent is shown, so every keyboard
  // path through the form carries `agree`. It only means anything on the screen
  // that actually asks for consent.
  function handleKeyDown(e) {
    if (e.key !== 'Enter') return;
    // A held Enter must not run the confirmation and the consent behind it together:
    // each of the two presses on this screen has to be a press of its own.
    if (e.repeat && (isConsentStep || showInlineConsent)) return;
    // Enter on a focused button or link has to activate that element — a choice
    // option, the Next button, a footer link. Advancing here instead would eat
    // the keystroke and skip the step without recording the answer.
    if (e.target.closest?.('button, a')) return;
    // Textareas need plain Enter for newlines; only advance on Ctrl/Cmd+Enter.
    if (step?.type === 'textarea' && !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    next({ agree: true });
  }

  // A step whose only control is a checkbox — or one the visitor answered by
  // clicking an option — can leave focus on the document body, out of reach of the
  // container's own handler. On the screens where Enter agrees, a window listener
  // picks up those strays; anything inside the form is left to the handler above.
  const agreeRef = useRef(null);
  agreeRef.current = () => next({ agree: true });
  useEffect(() => {
    if (!(isConsentStep || (consentInline && isLastStep)) || submitted) return;
    // The keystroke that advanced onto this step is still travelling towards the
    // window as this listener goes up, and holding the key sends repeats after it.
    // Arming on the next task, and ignoring auto-repeats, keeps one press from
    // answering the previous step and agreeing here in the same breath.
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 0);
    function onKey(e) {
      if (!armed || e.repeat || e.key !== 'Enter') return;
      // Enter on a focused button or link has to activate that element instead.
      if (e.target.closest?.('button, a')) return;
      // Inside the form the container's handler already ran; handling it here too
      // would submit twice. Only keystrokes that missed the form entirely get here.
      if (containerRef.current?.contains(e.target)) return;
      // A textarea's plain Enter is a newline, not a submission.
      if (step?.type === 'textarea' && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      agreeRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(armTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [isConsentStep, consentInline, isLastStep, step?.type, submitted]);

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

  // Leaving a step drops its confirmation: coming back has to ask again.
  useEffect(() => { setAnswerConfirmed(false); }, [currentStep]);

  const AUTO_ADVANCE_FIELDS = ['select', 'multi-select', 'yes-no', 'rating', 'image-select'];

  // A multiple-choice step with a free-text "Other" box never auto-advances:
  // every keystroke changes the answer, so it would jump away mid-sentence.
  const autoAdvances = step && AUTO_ADVANCE_FIELDS.includes(step.type)
    && !(step.type === 'multi-select' && step.allowOther);

  // Whether picking an option is all the visitor has to do on this step.
  const advancesOnClick = autoAdvances && !theme?.disableAutoAdvance;

  // Steps answered by clicking leave focus on the option that was clicked.
  const clickAnswered = !!step && AUTO_ADVANCE_FIELDS.includes(step.type);

  // Picking the last option can't carry the form away while the consent below is
  // still untouched, and firing the refusal at someone who has just answered would
  // be scolding them for reading on. The step waits for the agreement instead.
  const autoAdvanceHeldByConsent = showInlineConsent && !consentGiven;

  // Auto-advance for choice-based field types when answer is provided.
  // Capture the step index at schedule time and compare against the ref at
  // fire time so we don't advance if the user has already navigated away.
  useEffect(() => {
    if (step && answers[step.id] !== undefined && advancesOnClick && !autoAdvanceHeldByConsent) {
      const stepAtSchedule = currentStep;
      const timer = setTimeout(() => {
        if (currentStepRef.current === stepAtSchedule) next();
      }, 400);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers[step?.id]]);

  // On a step answered by clicking, the click leaves focus on the option, where
  // Enter would only re-pick it. Handing focus to the consent box once the answer
  // is in makes the hint below it true: Enter agrees, Space ticks. Text steps are
  // left alone — stealing the caret mid-word would be worse than a dead key.
  const consentBoxRef = useRef(null);
  useEffect(() => {
    if (inlineConsentReady && clickAnswered && !consentGiven) {
      consentBoxRef.current?.focus();
    }
  }, [inlineConsentReady, clickAnswered, consentGiven]);

  // Auto-redirect on submission. Navigates window.top so the browser leaves
  // any embedding iframe entirely, instead of just changing the iframe's own
  // location (which would strand the visitor inside the embedded form).
  useEffect(() => {
    if (submitted && endScreen.redirectUrl && endScreen.autoRedirect) {
      try {
        (window.top || window).location.href = endScreen.redirectUrl;
      } catch {
        window.location.href = endScreen.redirectUrl;
      }
    }
  }, [submitted]);

  if (submitted) {
    return (
      <LocaleContext.Provider value={locale}>
        {/* Keeps the same shell as the question screens (custom CSS, `embedded` class and
            animated background) so end-screen styling is themeable the same way. */}
        <div className={`form-renderer ${embedded ? 'embedded' : ''}`} style={themeVars} ref={containerRef}>
          {theme.customCss && <style>{theme.customCss}</style>}

          {bgAnimation !== 'none' && BG_SHAPES[bgAnimation] && (
            <div className={`form-bg-animation bg-${bgAnimation}`}>
              {Array.from({ length: BG_SHAPES[bgAnimation] }, (_, i) => <span key={i} />)}
            </div>
          )}

          <div className="form-end-screen slide-in-forward">
            <div className="end-icon">&#10003;</div>
            <h2>{endScreen.title || locale.thankYou}</h2>
            <p>{endScreen.message || locale.submittedMessage}</p>
            {endScreen.redirectUrl && endScreen.autoRedirect && (
              <p style={{ fontSize: 14, opacity: 0.6 }}>{locale.redirecting}</p>
            )}
            {endScreen.redirectUrl && (
              <a href={endScreen.redirectUrl} target="_top" className="form-btn" style={{ marginTop: 24 }}>
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

  const isMacPlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent || '');
  const enterKbdLabel = step?.type === 'textarea'
    ? (isMacPlatform ? '⌘ + Enter' : 'Ctrl + Enter')
    : 'Enter ↵';
  // Steps answered by clicking an option advance on the click itself, so an
  // "press Enter" hint is meaningless there — there is nothing to type and no
  // button to reach. It stays for choice steps that do wait for the button
  // (auto-advance turned off, or a multi-select with an "Other" box), where
  // Enter really is the shortcut to continue.
  // On the consent step the hint carries the keyboard shortcut that replaces the
  // click, so it is shown whether or not the form enables hints elsewhere —
  // without it the Enter path is invisible. CSS still hides it on touch devices,
  // where there is no keyboard and the box is tapped instead.
  // Everywhere else the hint waits for the step to be ready to move on, the same
  // rule the consent hint follows: it appears as the answer lands, which is the
  // moment it becomes true, and repeating that on every step is what teaches the
  // visitor that the whole form can be walked through on Enter alone. A step with
  // nothing required is ready from the outset — Enter does move on from there.
  const enterHint = isConsentStep ? (
    <span className="form-enter-hint">
      {locale.consentEnterBefore}<kbd>Enter ↵</kbd>{locale.consentEnterAfter}
    </span>
  ) : showEnterHint && !advancesOnClick && stepReady ? (
    <span className="form-enter-hint">
      {locale.enterHintBefore}<kbd>{enterKbdLabel}</kbd>{locale.enterHintAfter}
    </span>
  ) : null;

  // The last step of an inline-consent form carries its own pair of hints, one after
  // the other, so the one by the button would only get in their way.
  const stepEnterHint = showInlineConsent ? null : enterHint;

  // Both hints of the inline flow belong to the consent path, so — like the consent
  // step's hint — they show whether or not the form uses hints elsewhere: without
  // them the two presses are invisible. The first sits under the field the visitor
  // just filled in and offers to confirm it; once it is confirmed the hint is gone
  // from there and the one under the checkbox has taken over.
  // The slot is always there once the consent is on the step, so the checkbox below
  // it doesn't jump up as the hint hands over to the one underneath it.
  const consentConfirmHint = showInlineConsent ? (
    <div className="form-consent-confirm">
      {inlineConsentReady && !consentAwaited && (
        <span className="form-enter-hint">
          {locale.enterHintBefore}<kbd>{enterKbdLabel}</kbd>{locale.consentEnterConfirmAfter}
        </span>
      )}
    </div>
  ) : null;

  const consentBlock = showInlineConsent ? (
    <div className="form-consent-inline">
      <label className="form-consent">
        <input
          ref={consentBoxRef}
          type="checkbox"
          checked={consentGiven}
          onChange={e => { setConsentGiven(e.target.checked); setError(''); }}
        />
        <span className="consent-text">{consentText}</span>
      </label>
      {/* Reserved like the slot above it: the two hints take turns without the step
          resizing under the visitor between the presses. */}
      <div className="form-consent-hint-slot">
        {consentAwaited && (
          <span className="form-enter-hint">
            {locale.consentEnterBefore}
            <kbd>{enterKbdLabel}</kbd>
            {consentGiven ? locale.consentEnterSubmitAfter : locale.consentEnterAgreeSubmitAfter}
          </span>
        )}
      </div>
    </div>
  ) : null;

  const nextButton = (
    <button className="form-btn" onClick={next}>
      {isLastStep ? (theme.submitButtonLabel || locale.submit) : (theme.nextButtonLabel || locale.next)} &#8594;
    </button>
  );

  return (
    <LocaleContext.Provider value={locale}>
    <div className={`form-renderer ${embedded ? 'embedded' : ''}`} style={themeVars} onKeyDown={handleKeyDown} ref={containerRef} role="form" aria-label={form.title || undefined}>
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

      <div
        className="form-progress"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={locale.stepProgress(currentStep + 1, steps.length)}
      >
        <div className="form-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <div className="form-content">
        <div className={`form-step ${direction === 'forward' ? 'slide-in-forward' : 'slide-in-back'}`} key={currentStep}>
          {step.type === 'group' ? (
            <>
              <GroupInput step={step} answers={answers} setFieldAnswer={setFieldAnswer} formSlug={form.slug} />
              {consentConfirmHint}
              {consentBlock}
              {(buttonPosition === 'below-input' || buttonPosition === 'inline') && (
                <div className={buttonPosition === 'below-input' ? 'form-below-input-actions' : 'form-inline-actions'}>
                  {nextButton}
                  {stepEnterHint}
                </div>
              )}
            </>
          ) : (
            <>
              {step.label && <span className="step-label">{step.label}</span>}
              <h2 className="step-question" id={`step-question-${step.id}`}>{step.question}</h2>
              {step.description && <p className="step-description">{step.description}</p>}

              <div className="step-field" role="group" aria-labelledby={`step-question-${step.id}`}>
                {isConsentStep ? (
                  <ConsentStepInput
                    text={consentText}
                    checked={consentGiven}
                    onChange={checked => { setConsentGiven(checked); setError(''); }}
                  />
                ) : (
                  <FieldComponent
                    step={displayStep}
                    value={answers[step.id]}
                    onChange={setAnswer}
                    formSlug={form.slug}
                  />
                )}
                {consentConfirmHint}
                {consentBlock}
                {buttonPosition === 'below-input' && (
                  <div className="form-below-input-actions">
                    {nextButton}
                    {stepEnterHint}
                  </div>
                )}
              </div>

              {/* Inline button (below input but after question) */}
              {buttonPosition === 'inline' && (
                <div className="form-inline-actions">
                  {nextButton}
                  {stepEnterHint}
                </div>
              )}
            </>
          )}

          {error && <p className="step-error" role="alert">{error}</p>}
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
        <button className="form-nav-btn" onClick={prev} disabled={currentStep === 0} aria-label={locale.previousStep}>
          &#8592;
        </button>
        <span className="form-step-count">{currentStep + 1} / {steps.length}</span>
        <div className="form-nav-actions">
          {buttonPosition === 'footer' && stepEnterHint}
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

// Note `value ?? ''` rather than `value || ''` throughout: a legitimate 0 is falsy and
// used to blank the field out again the moment it was typed.
function NumberInput({ step, value, onChange }) {
  const min = toNumberOrNull(step.min);
  const max = toNumberOrNull(step.max);
  const fallback = toNumberOrNull(step.defaultValue);
  const stepSize = Math.abs(Number(step.stepSize)) || 1;

  const current = toNumberOrNull(value);
  const atMin = min !== null && current !== null && current <= min;
  const atMax = max !== null && current !== null && current >= max;

  function clamp(n) {
    if (min !== null && n < min) return min;
    if (max !== null && n > max) return max;
    return n;
  }

  // The first press on an empty field lands on the configured default, else the minimum,
  // else zero — so +/- is useful even when nothing is prefilled.
  function nudge(delta) {
    if (current === null) { onChange(String(clamp(fallback ?? min ?? 0))); return; }
    onChange(String(clamp(current + delta)));
  }

  const input = (
    <input
      className="form-input"
      type="number"
      placeholder={step.placeholder || '0'}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      min={min ?? undefined}
      max={max ?? undefined}
      autoFocus
    />
  );

  if (step.hideStepper) return input;

  return (
    <div className="form-number-stepper">
      <button type="button" className="form-stepper-btn" onClick={() => nudge(-stepSize)} disabled={atMin} aria-label={`−${stepSize}`}>−</button>
      <div className="form-stepper-value">{input}</div>
      <button type="button" className="form-stepper-btn" onClick={() => nudge(stepSize)} disabled={atMax} aria-label={`+${stepSize}`}>+</button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Calendar — an always-visible month grid, hand-rolled so the form pulls in no
   date library. Dates are handled as plain "YYYY-MM-DD" strings and as
   {y, m, d} parts; no Date objects cross a timezone boundary, so a day never
   shifts for visitors west of UTC.
--------------------------------------------------------------------------- */

function toISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayISO() {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function addMonths(y, m, delta) {
  const total = y * 12 + m + delta;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
}

function CalendarMonth({ y, m, locale, isDisabled, dayState, onPick, onHover }) {
  const weekStart = locale.weekStartsOn || 0;
  const weekdays = Array.from({ length: 7 }, (_, i) => locale.weekdayShort[(weekStart + i) % 7]);
  // Blank cells before the 1st, so the first day lands under its weekday column.
  const lead = (new Date(y, m, 1).getDay() - weekStart + 7) % 7;
  const total = daysInMonth(y, m);

  return (
    <div className="form-calendar-month">
      <div className="form-calendar-title">{locale.monthNames[m]} {y}</div>
      <div className="form-calendar-grid">
        {weekdays.map(w => <div key={w} className="form-calendar-weekday">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`pad${i}`} />)}
        {Array.from({ length: total }, (_, i) => {
          const day = i + 1;
          const iso = toISO(y, m, day);
          const disabled = isDisabled(iso);
          return (
            <button
              key={iso}
              type="button"
              className={`form-calendar-day ${dayState(iso)}`}
              disabled={disabled}
              onClick={() => onPick(iso)}
              onMouseEnter={() => onHover?.(iso)}
              aria-label={locale.dateDisplay(day, locale.monthNames[m], y)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateInput({ step, value, onChange }) {
  const locale = useLocale();
  const isRange = step.dateMode === 'range';
  const { start, end } = parseDateValue(value);

  const minDate = step.disablePast
    ? (step.minDate && step.minDate > todayISO() ? step.minDate : todayISO())
    : (step.minDate || '');
  const maxDate = step.maxDate || '';

  // Open on the month of the current answer, else the first month the visitor may pick.
  const anchor = start || minDate || todayISO();
  const [view, setView] = useState(() => ({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 }));
  const [hovered, setHovered] = useState('');

  const months = isRange ? [view, addMonths(view.y, view.m, 1)] : [view];

  function isDisabled(iso) {
    if (minDate && iso < minDate) return true;
    if (maxDate && iso > maxDate) return true;
    return false;
  }

  // The second visible month is what bounds "next" in range mode, so the arrow greys out
  // only once there is genuinely nothing left to show.
  const lastVisible = months[months.length - 1];
  const prevDisabled = !!minDate && toISO(view.y, view.m, 1) <= minDate;
  const nextDisabled = !!maxDate && toISO(lastVisible.y, lastVisible.m, daysInMonth(lastVisible.y, lastVisible.m)) >= maxDate;

  function dayState(iso) {
    if (!isRange) return iso === start ? 'selected' : '';
    if (iso === start) return end || hovered > start ? 'selected range-start' : 'selected';
    if (iso === end) return 'selected range-end';
    const rangeEnd = end || (start && hovered > start ? hovered : '');
    if (start && rangeEnd && iso > start && iso < rangeEnd) return 'in-range';
    return '';
  }

  function pick(iso) {
    if (!isRange) { onChange(iso); return; }
    // A complete range restarts on the next click; a click at or before the start
    // moves the start there rather than producing a backwards range.
    if (!start || end || iso <= start) onChange(formatDateRange(iso, ''));
    else onChange(formatDateRange(start, iso));
  }

  function label(iso) {
    if (!iso) return '—';
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7)) - 1;
    return locale.dateDisplay(Number(iso.slice(8, 10)), locale.monthNames[m], y);
  }

  return (
    <div className="form-calendar" onMouseLeave={() => setHovered('')} role="group" aria-label={isRange ? locale.dateHintRange : locale.dateHintSingle}>
      {/* A bare grid of days doesn't say how many dates it wants — visitors on a range
          step read it as "pick a day" and move on. The step's own description wins if
          the builder wrote one. */}
      {!step.description && (
        <div className="form-calendar-hint">{isRange ? locale.dateHintRange : locale.dateHintSingle}</div>
      )}
      {/* The nav arrows pin to this box, not to the whole calendar, so the hint above
          doesn't push them out of line with the month titles. */}
      <div className="form-calendar-body">
        <div className="form-calendar-header">
          <button
            type="button"
            className="form-calendar-nav"
            onClick={() => setView(addMonths(view.y, view.m, -1))}
            disabled={prevDisabled}
            aria-label={locale.datePrevMonth}
          >‹</button>
          <button
            type="button"
            className="form-calendar-nav"
            onClick={() => setView(addMonths(view.y, view.m, 1))}
            disabled={nextDisabled}
            aria-label={locale.dateNextMonth}
          >›</button>
        </div>

        <div className="form-calendar-months">
          {months.map(({ y, m }) => (
            <CalendarMonth
              key={`${y}-${m}`}
              y={y}
              m={m}
              locale={locale}
              isDisabled={isDisabled}
              dayState={dayState}
              onPick={pick}
              onHover={isRange ? setHovered : undefined}
            />
          ))}
        </div>
      </div>

      {/* In range mode the From/To pair shows from the start, empty slots and all: two
          labelled blanks are the clearest signal that two dates are wanted. */}
      {(isRange || start) && (
        <div className="form-calendar-summary">
          {isRange ? (
            <span>
              <strong>{locale.dateFrom}:</strong> {label(start)}
              {' · '}
              <strong>{locale.dateTo}:</strong> {label(end)}
            </span>
          ) : (
            <span>{label(start)}</span>
          )}
          {(start || end) && (
            <button type="button" className="form-calendar-clear" onClick={() => onChange('')}>{locale.dateClear}</button>
          )}
        </div>
      )}
    </div>
  );
}

// Groups calon's `slots` (each `{start, end, timezone}`, start like
// "2026-09-02T09:30:00+02:00") into { "2026-09-02": ["09:30", ...] }. calon
// already expressed them in the resource's own timezone, so this is just
// slicing the ISO string — no timezone math needed on this side at all.
function groupCalonSlotsByDate(slots) {
  const byDate = {};
  for (const slot of slots || []) {
    const date = slot.start.slice(0, 10);
    const time = slot.start.slice(11, 16);
    (byDate[date] || (byDate[date] = [])).push(time);
  }
  return byDate;
}

// The no-calon fallback: every day in the field's range gets the same list of
// times, spaced by `durationMin` across `windowStart`..`windowEnd`. No weekday
// or blackout awareness — that's exactly what connecting calon buys you.
function generateStandaloneSlots(step) {
  const duration = Math.max(5, parseInt(step.durationMin, 10) || 30);
  const rangeDays = Math.min(Math.max(parseInt(step.rangeDays, 10) || 14, 1), 90);
  const [sh, sm] = (step.windowStart || '09:00').split(':').map(Number);
  const [eh, em] = (step.windowEnd || '17:00').split(':').map(Number);
  const endMinutes = (eh || 0) * 60 + (em || 0);

  const times = [];
  for (let cursor = (sh || 0) * 60 + (sm || 0); cursor + duration <= endMinutes; cursor += duration) {
    times.push(`${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`);
  }

  const byDate = {};
  const base = new Date();
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    byDate[toISO(d.getFullYear(), d.getMonth(), d.getDate())] = times;
  }
  return byDate;
}

function DateTimeslotInput({ step, value, onChange, formSlug }) {
  const locale = useLocale();
  const { date: selDate, time: selTime } = parseDateTimeslotValue(value);
  const calonEnabled = !!(step.calon?.enabled && step.calon?.baseUrl);

  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(calonEnabled);

  useEffect(() => {
    if (!calonEnabled || !formSlug) {
      setRemote(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const baseUrl = window.__OPENFLOW_BASE_URL__ || '';
    fetch(`${baseUrl}/api/public/form/${encodeURIComponent(formSlug)}/availability?fieldId=${encodeURIComponent(step.id)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('unavailable'))))
      .then(body => { if (!cancelled) setRemote(body); })
      // calon unreachable or misconfigured: fall back to the standalone
      // generator below rather than blocking the step entirely.
      .catch(() => { if (!cancelled) setRemote(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [calonEnabled, formSlug, step.id]);

  const timezone = remote?.timezone || '';
  const slotsByDate = React.useMemo(
    () => (remote ? groupCalonSlotsByDate(remote.slots) : generateStandaloneSlots(step)),
    [remote, step]
  );
  const availableDates = Object.keys(slotsByDate).sort();

  const anchor = (selDate && slotsByDate[selDate]) ? selDate : (availableDates[0] || todayISO());
  const [view, setView] = useState(() => ({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 }));

  // The view above is seeded from today's month before calon has answered. If the
  // real availability that lands is somewhere else — this month is fully booked —
  // jump the calendar there instead of leaving the visitor on an all-disabled month.
  useEffect(() => {
    if (!remote) return;
    const dates = Object.keys(groupCalonSlotsByDate(remote.slots)).sort();
    if (!selDate && dates[0]) {
      setView({ y: Number(dates[0].slice(0, 4)), m: Number(dates[0].slice(5, 7)) - 1 });
    }
    // Only on a fresh fetch result, and only if the visitor hasn't already picked a
    // date — re-centering the calendar under them would be jarring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  if (loading) {
    return <div className="form-calendar-hint">{locale.dateTimeslotLoading}</div>;
  }

  function isDisabled(iso) { return !slotsByDate[iso]; }
  function dayState(iso) { return iso === selDate ? 'selected' : ''; }
  function pickDate(iso) { onChange(formatDateTimeslot(iso, '', timezone)); }
  function pickTime(t) { onChange(formatDateTimeslot(selDate, t, timezone)); }

  const minIso = availableDates[0];
  const maxIso = availableDates[availableDates.length - 1];
  const prevDisabled = !!minIso && toISO(view.y, view.m, 1) <= minIso;
  const nextDisabled = !!maxIso && toISO(view.y, view.m, daysInMonth(view.y, view.m)) >= maxIso;
  const times = selDate ? (slotsByDate[selDate] || []) : [];

  return (
    <div className="form-calendar" role="group" aria-label={locale.dateTimeslotPickDate}>
      {!step.description && <div className="form-calendar-hint">{locale.dateTimeslotPickDate}</div>}
      <div className="form-calendar-body">
        <div className="form-calendar-header">
          <button type="button" className="form-calendar-nav" onClick={() => setView(addMonths(view.y, view.m, -1))} disabled={prevDisabled} aria-label={locale.datePrevMonth}>‹</button>
          <button type="button" className="form-calendar-nav" onClick={() => setView(addMonths(view.y, view.m, 1))} disabled={nextDisabled} aria-label={locale.dateNextMonth}>›</button>
        </div>
        <div className="form-calendar-months">
          <CalendarMonth y={view.y} m={view.m} locale={locale} isDisabled={isDisabled} dayState={dayState} onPick={pickDate} />
        </div>
      </div>

      {selDate && (
        <div className="form-dateslot-times">
          <div className="form-calendar-hint">{locale.dateTimeslotPickTime}</div>
          {times.length === 0 ? (
            <p className="form-dateslot-empty">{locale.dateTimeslotNoSlots}</p>
          ) : (
            <div className="form-options">
              {times.map(t => (
                <button key={t} type="button" className={`form-option ${selTime === t ? 'selected' : ''}`} onClick={() => pickTime(t)} aria-pressed={selTime === t}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
          <button key={i} className={`form-option ${value === optValue ? 'selected' : ''}`} onClick={() => onChange(optValue)} aria-pressed={value === optValue}>
            {optLabel}
          </button>
        );
      })}
    </div>
  );
}

function MultiSelectInput({ step, value, onChange }) {
  const locale = useLocale();
  const selected = value || [];
  const options = step.options || [];
  const optionValues = options.map(opt => typeof opt === 'string' ? opt : (opt.value ?? opt.label));

  // The free-text answer is stored as a plain string in the same array as the
  // regular choices, so exports and integrations need no special handling. On
  // the way back in it's the selected value that isn't a configured option —
  // that's what restores the text when navigating back to this step.
  const initialOther = step.allowOther ? (selected.find(v => !optionValues.includes(v)) || '') : '';
  const [otherText, setOtherText] = useState(initialOther);
  const [otherOpen, setOtherOpen] = useState(!!initialOther);

  // Ticked checkboxes come from the answer; the free text is held locally, so
  // typing an option's own label doesn't make the box appear to clear itself.
  // Only the current free text is split off — a value the pricing filter has
  // since hidden stays in the answer instead of being silently dropped.
  const chosen = otherText ? selected.filter(v => v !== otherText) : selected;

  function emit(nextChosen, nextOther) {
    const text = nextOther.trim();
    // An empty box means "Other" is ticked but unanswered: keep the input open,
    // just don't put a blank entry into the answer.
    onChange(text && !nextChosen.includes(text) ? [...nextChosen, text] : nextChosen);
  }

  function toggle(optValue) {
    const next = chosen.includes(optValue)
      ? chosen.filter(v => v !== optValue)
      : [...chosen, optValue];
    emit(next, otherText);
  }

  function changeOther(text) {
    setOtherText(text);
    emit(chosen, text);
  }

  function toggleOther() {
    if (otherOpen) {
      setOtherOpen(false);
      setOtherText('');
      emit(chosen, '');
    } else {
      setOtherOpen(true);
    }
  }

  return (
    <div className="form-options">
      {options.map((opt, i) => {
        const optValue = typeof opt === 'string' ? opt : (opt.value ?? opt.label);
        const optLabel = typeof opt === 'string' ? opt : opt.label;
        return (
          <button key={i} className={`form-option ${chosen.includes(optValue) ? 'selected' : ''}`} onClick={() => toggle(optValue)} aria-pressed={chosen.includes(optValue)}>
            <span className="option-key">{chosen.includes(optValue) ? '✓' : ''}</span>
            {optLabel}
          </button>
        );
      })}
      {step.allowOther && (
        <>
          <button className={`form-option ${otherOpen ? 'selected' : ''}`} onClick={toggleOther} aria-pressed={otherOpen}>
            <span className="option-key">{otherOpen ? '✓' : ''}</span>
            {step.otherLabel || locale.otherOption}
          </button>
          {otherOpen && (
            <input
              className="form-input form-option-other"
              type="text"
              placeholder={step.otherPlaceholder || locale.otherPlaceholder}
              value={otherText}
              onChange={e => changeOther(e.target.value)}
              autoFocus
            />
          )}
        </>
      )}
    </div>
  );
}

function YesNoInput({ step, value, onChange }) {
  const locale = useLocale();
  return (
    <div className="form-options form-yesno">
      <button className={`form-option ${value === 'yes' ? 'selected' : ''}`} onClick={() => onChange('yes')} aria-pressed={value === 'yes'}>
        {locale.yes}
      </button>
      <button className={`form-option ${value === 'no' ? 'selected' : ''}`} onClick={() => onChange('no')} aria-pressed={value === 'no'}>
        {locale.no}
      </button>
    </div>
  );
}

function RatingInput({ step, value, onChange }) {
  const locale = useLocale();
  const max = step.max || 5;
  return (
    <div className="form-rating">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button
          key={n}
          className={`rating-star ${value >= n ? 'active' : ''}`}
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          aria-label={locale.starRating(n, max)}
        >
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
      {customFields.map((field, idx) => {
        const fieldLabelId = `addr-label-${field.id || idx}`;
        return (
        <div key={field.id || idx} style={{ marginTop: 12 }}>
          {field.type === 'text' && (
            <>
              <label id={fieldLabelId} htmlFor={`addr-input-${field.id}`} style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--form-text)' }}>{field.label}</label>
              <input id={`addr-input-${field.id}`} className="form-input" type="text" value={data[field.id] || ''} onChange={e => update(field.id, e.target.value)} />
            </>
          )}
          {field.type === 'dropdown' && (
            <>
              <label id={fieldLabelId} htmlFor={`addr-input-${field.id}`} style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--form-text)' }}>{field.label}</label>
              <select id={`addr-input-${field.id}`} className="form-input" value={data[field.id] || ''} onChange={e => update(field.id, e.target.value)}>
                <option value="">{locale.addressSelect}</option>
                {(field.options || '').split(',').map((opt, i) => (
                  <option key={i} value={opt.trim()}>{opt.trim()}</option>
                ))}
              </select>
            </>
          )}
          {field.type === 'radio' && (
            <>
              <span id={fieldLabelId} style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--form-text)' }}>{field.label}</span>
              <div role="radiogroup" aria-labelledby={fieldLabelId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        );
      })}
    </div>
  );
}

// The GDPR consent as its own step: a large, tappable card that is also the target
// of the Enter shortcut. The checkbox stays a real checkbox so a pointer, a tap and
// the Tab/Space route all keep working.
function ConsentStepInput({ text, checked, onChange }) {
  return (
    <label className={`form-consent form-consent-step${checked ? ' checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} autoFocus />
      <span className="consent-text">{text}</span>
    </label>
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
        role="button"
        tabIndex={0}
        aria-label={value ? fileName : locale.fileUploadPrompt}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            // This div isn't a real <button>, so the form-wide Enter handler
            // (which advances/submits the step, and skips real buttons/links
            // via e.target.closest('button, a')) would otherwise also fire
            // for this keystroke — stop it here the same way it stops for those.
            e.stopPropagation();
            fileRef.current?.click();
          }
        }}
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
      {error && <p className="step-error" role="alert" style={{ marginTop: 8 }}>{error}</p>}
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
            aria-pressed={value === optValue}
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
