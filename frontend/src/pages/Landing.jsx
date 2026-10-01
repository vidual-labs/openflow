import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark, LogoWordmark } from '../components/AdminUI';
import LandingBackground from '../components/LandingBackground';
import './Landing.css';

const GITHUB_URL = 'https://github.com/vidual-labs/openflow';
const QUICK_START = [
  'git clone https://github.com/vidual-labs/openflow.git',
  'cd openflow',
  'docker compose up -d',
];

const FIELD_TYPES = [
  'Short Text', 'Long Text', 'Number', 'Date', 'Date & Timeslot', 'Single Choice', 'Multiple Choice',
  'Yes / No', 'Rating', 'Image Select', 'File Upload', 'Email', 'Phone', 'Website', 'Address',
];

const DESTINATIONS = [
  'Webhooks', 'SMTP Email', 'Google Sheets', 'Google Ads', 'Meta Conversions API', 'Google Tag Manager',
  'WordPress', 'calon', 'CSV Export', 'REST API',
];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Adds `is-visible` to every `.lp-reveal` inside `root` once it scrolls into view. */
function useReveal(rootRef) {
  useEffect(() => {
    const nodes = rootRef.current?.querySelectorAll('.lp-reveal') || [];
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      nodes.forEach(n => n.classList.add('is-visible'));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    nodes.forEach(n => observer.observe(n));
    return () => observer.disconnect();
  }, [rootRef]);
}

/** Lets a card's radial highlight follow the pointer (`--mx` / `--my`). */
function trackSpotlight(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions) — nothing to do.
    }
  }
  return (
    <button type="button" className="lp-copy" onClick={copy} aria-label={copied ? 'Copied' : label}>
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

function GitHubIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="lp-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

const DEMO_STEPS = [
  { kind: 'choice', question: 'What are you planning?', options: ['New website', 'Online shop', 'Rebranding'], pick: 1 },
  { kind: 'choice', question: "What's your budget?", options: ['Under €5k', '€5k – €15k', '€15k +'], pick: 2 },
  { kind: 'email', question: 'Where can we reach you?', value: 'alex@northwind.io' },
  { kind: 'done' },
];

/**
 * A self-playing mock of a published form: it picks answers, types an email
 * and "submits", then shows where the lead went. Purely decorative.
 */
function DemoForm() {
  const [step, setStep] = useState(prefersReducedMotion() ? 1 : 0);
  const [picked, setPicked] = useState(prefersReducedMotion() ? 2 : null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const current = DEMO_STEPS[step];
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));

    if (current.kind === 'choice') {
      at(1300, () => setPicked(current.pick));
      at(2300, () => { setPicked(null); setStep(s => s + 1); });
    } else if (current.kind === 'email') {
      for (let i = 1; i <= current.value.length; i++) {
        at(600 + i * 70, () => setTyped(current.value.slice(0, i)));
      }
      at(600 + current.value.length * 70 + 900, () => setStep(s => s + 1));
    } else {
      at(4200, () => { setTyped(''); setStep(0); });
    }
    return () => timers.forEach(clearTimeout);
  }, [step]);

  const current = DEMO_STEPS[step];
  const progress = Math.round((step / (DEMO_STEPS.length - 1)) * 100);

  return (
    <div className="lp-demo" aria-hidden="true">
      <div className="lp-demo-chrome">
        <span /><span /><span />
        <div className="lp-demo-url">forms.northwind.io/f/project-inquiry</div>
      </div>
      <div className="lp-demo-progress"><div style={{ width: `${progress}%` }} /></div>
      <div className="lp-demo-body" key={step}>
        {current.kind === 'choice' && (
          <>
            <div className="lp-demo-count">{step + 1} <span>→</span></div>
            <h3>{current.question}</h3>
            <div className="lp-demo-options">
              {current.options.map((o, i) => (
                <div key={o} className={`lp-demo-option${picked === i ? ' is-picked' : ''}`}>
                  <kbd>{String.fromCharCode(65 + i)}</kbd>{o}
                  {picked === i && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </div>
              ))}
            </div>
          </>
        )}
        {current.kind === 'email' && (
          <>
            <div className="lp-demo-count">{step + 1} <span>→</span></div>
            <h3>{current.question}</h3>
            <div className="lp-demo-input">{typed}<i className="lp-caret" /></div>
            <div className="lp-demo-submit">Submit <span>press Enter ↵</span></div>
          </>
        )}
        {current.kind === 'done' && (
          <div className="lp-demo-done">
            <div className="lp-demo-check">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h3>Thanks, we'll be in touch!</h3>
            <div className="lp-demo-routes">
              {['Webhook', 'Google Sheets', 'Meta CAPI', 'Email'].map((r, i) => (
                <span key={r} style={{ animationDelay: `${300 + i * 260}ms` }}><i />{r} <b>200</b></span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FunnelBars() {
  const rows = [
    { label: 'Views', value: 100, count: '12,480' },
    { label: 'Starts', value: 64, count: '7,987' },
    { label: 'Step 3', value: 47, count: '5,866' },
    { label: 'Completed', value: 38, count: '4,742' },
  ];
  return (
    <div className="lp-funnel">
      {rows.map((r, i) => (
        <div className="lp-funnel-row" key={r.label}>
          <span>{r.label}</span>
          <div className="lp-funnel-track"><div style={{ '--w': `${r.value}%`, transitionDelay: `${i * 120}ms` }} /></div>
          <b>{r.count}</b>
        </div>
      ))}
    </div>
  );
}

const DELIVERY_LOG = [
  ['14:02:11', 'POST', 'hooks.northwind.io/leads', '200', 'ok'],
  ['14:02:11', 'SMTP', 'sales@northwind.io', '250', 'ok'],
  ['14:02:12', 'POST', 'graph.facebook.com/…/events', '200', 'ok'],
  ['14:02:12', 'POST', 'datamanager.googleapis.com', '503', 'retry'],
  ['14:02:42', 'POST', 'datamanager.googleapis.com', '200', 'ok'],
];

function Features() {
  return (
    <div className="lp-bento">
      <article className="lp-cell lp-cell-wide lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">01 / Builder</div>
        <h3>A multi-step builder that feels like Typeform.</h3>
        <p>One question at a time, smooth transitions, keyboard shortcuts and smart defaults. Combine steps, reorder with a click, and preview every change live.</p>
        <div className="lp-chips">
          {FIELD_TYPES.map((f, i) => <span key={f} style={{ transitionDelay: `${i * 35}ms` }}>{f}</span>)}
        </div>
      </article>

      <article className="lp-cell lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">02 / Logic</div>
        <h3>Conditional logic.</h3>
        <p>Show or hide steps based on earlier answers. Enforced again on the server, too.</p>
        <div className="lp-logic">
          <div><em>if</em> budget <em>is</em> <code>€15k +</code></div>
          <div className="lp-logic-line" />
          <div><em>show</em> <code>Timeline</code> · <code>Book a call</code></div>
        </div>
      </article>

      <article className="lp-cell lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">03 / Analytics</div>
        <h3>See where leads drop off.</h3>
        <p>A funnel from view to completion, plus drop-off for every step.</p>
        <FunnelBars />
      </article>

      <article className="lp-cell lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">04 / Booking</div>
        <h3>Book meetings inside the form.</h3>
        <p>Date & Timeslot fields can show real availability from a self-hosted <a href="https://github.com/vidual-labs/calon" target="_blank" rel="noopener noreferrer">calon</a> calendar.</p>
        <div className="lp-slots">
          {['09:00', '09:30', '10:30', '11:00', '14:00', '15:30'].map((s, i) => (
            <span key={s} className={i === 2 ? 'is-picked' : ''}>{s}</span>
          ))}
        </div>
      </article>

      <article className="lp-cell lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">05 / Embed</div>
        <h3>Drop it in anywhere.</h3>
        <p>Its own link, an auto-resizing iframe, a WordPress block, or its own subdomain.</p>
        <pre className="lp-snippet"><span className="t">&lt;iframe</span> <span className="a">src</span>=<span className="s">"…/embed/inquiry"</span><span className="t">&gt;</span>{'\n'}<span className="c">[openflow slug="inquiry"]</span>{'\n'}<span className="s">acme.forms.example.com</span></pre>
      </article>

      <article className="lp-cell lp-cell-wide lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">06 / Integrations</div>
        <h3>Every lead gets where it needs to go.</h3>
        <p>Webhooks with HMAC signatures, SMTP email, Google Sheets, Google Ads and the Meta Conversions API. Every delivery is stored and retried with backoff, so a short outage doesn't lose a lead.</p>
        <div className="lp-log">
          {DELIVERY_LOG.map((row, i) => (
            <div key={i} className={`lp-log-row is-${row[4]}`} style={{ transitionDelay: `${i * 140}ms` }}>
              <span>{row[0]}</span><span>{row[1]}</span><span>{row[2]}</span><b>{row[3]}</b>
            </div>
          ))}
        </div>
      </article>

      <article className="lp-cell lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">07 / Privacy</div>
        <h3>GDPR-ready by default.</h3>
        <p>Consent steps, a cookie banner, and ad click IDs only captured after consent. Your data stays on your own server.</p>
        <label className="lp-consent"><span className="lp-box" />I agree to the privacy policy.</label>
      </article>

      <article className="lp-cell lp-cell-wide lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">08 / Design</div>
        <h3>On brand, down to the background.</h3>
        <p>Colors, fonts, custom CSS, a landing-page mode and five animated backgrounds, all with a live preview while you edit.</p>
        <div className="lp-design">
          <div className="lp-swatches">
            {['#6C5CE7', '#00CEC9', '#FD79A8', '#FDCB6E', '#E17055'].map(c => <span key={c} style={{ background: c }} />)}
          </div>
          <div className="lp-chips lp-chips-inline">
            {['Waves', 'Aurora', 'Gradient Wave', 'Gateway Flow', 'Flow'].map((b, i) => <span key={b} style={{ transitionDelay: `${i * 60}ms` }}>{b}</span>)}
          </div>
        </div>
      </article>

      <article className="lp-cell lp-reveal" onPointerMove={trackSpotlight}>
        <div className="lp-cell-label">09 / Teams</div>
        <h3>Teams, API &amp; backups.</h3>
        <p>Invite users with roles, read leads through read-only API tokens, and keep rotating backups.</p>
        <div className="lp-token">
          <span>ofw_3f9a…c71e</span><b>read-only</b>
        </div>
      </article>
    </div>
  );
}

export default function Landing({ version }) {
  const rootRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  useReveal(rootRef);

  useEffect(() => {
    const previous = document.title;
    document.title = 'OpenFlow — Open-source form builder for lead generation';
    document.body.classList.add('lp-body');
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.title = previous;
      document.body.classList.remove('lp-body');
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="lp" ref={rootRef}>
      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="lp-container lp-nav-inner">
          <a href="#top" className="lp-brand"><LogoMark size={22} /><LogoWordmark /></a>
          <nav className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#tracking">Tracking</a>
            <a href="#self-host">Self-host</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          </nav>
          <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-sm">Sign in</Link>
        </div>
      </header>

      <main id="top">
        <section className="lp-hero">
          <LandingBackground className="lp-hero-canvas" />
          <div className="lp-hero-grid" aria-hidden="true" />
          <div className="lp-hero-glow" aria-hidden="true" />
          <div className="lp-container lp-hero-inner">
            <div className="lp-hero-copy">
              <a className="lp-pill lp-reveal" href={`${GITHUB_URL}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">
                <span className="lp-pill-dot" />
                {version ? `v${version}` : 'Latest'} · Open source · GPL-3.0
                <Arrow />
              </a>
              <h1 className="lp-reveal">
                Forms that turn<br />visitors into <span className="lp-gradient-text">leads.</span>
              </h1>
              <p className="lp-lead lp-reveal">
                OpenFlow is the open-source, self-hosted alternative to Typeform and Heyflow.
                Multi-step forms, conditional logic and server-side conversion tracking, running on your own server.
              </p>
              <div className="lp-actions lp-reveal">
                <a href="#self-host" className="lp-btn lp-btn-primary">Get started <Arrow /></a>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost"><GitHubIcon /> Star on GitHub</a>
              </div>
              <div className="lp-command lp-reveal">
                <span className="lp-prompt">$</span>
                <code>docker compose up -d</code>
                <CopyButton text="docker compose up -d" label="Copy command" />
              </div>
            </div>
            <div className="lp-hero-visual lp-reveal">
              <DemoForm />
            </div>
          </div>
        </section>

        <section className="lp-marquee-section" aria-label="Integrations">
          <div className="lp-container lp-marquee-label">Sends every lead to</div>
          <div className="lp-marquee">
            <div className="lp-marquee-track">
              {[...DESTINATIONS, ...DESTINATIONS].map((d, i) => (
                <span key={i} aria-hidden={i >= DESTINATIONS.length ? 'true' : undefined}>{d}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-container">
            <div className="lp-section-head lp-reveal">
              <div className="lp-eyebrow">// Features</div>
              <h2>Everything a lead form needs.<br /><span className="lp-muted">Nothing you have to rent.</span></h2>
            </div>
            <Features />
          </div>
        </section>

        <section className="lp-section lp-split" id="tracking">
          <div className="lp-container lp-split-inner">
            <div className="lp-split-copy lp-reveal">
              <div className="lp-eyebrow">// Conversion tracking</div>
              <h2>Server-side conversions that ad blockers can't block.</h2>
              <p>
                OpenFlow captures <code>gclid</code>, <code>gbraid</code>, <code>wbraid</code> and <code>fbclid</code> after cookie consent.
                It sends each lead to Google Ads and the Meta Conversions API straight from your server.
                A shared event ID deduplicates it against your Pixel.
              </p>
              <ul className="lp-checklist">
                <li>Google Ads offline conversions via the Data Manager API</li>
                <li>Meta <code>Lead</code> events with hashed email &amp; phone</li>
                <li>GTM <code>dataLayer</code> events for every step and submit</li>
              </ul>
            </div>
            <div className="lp-terminal lp-reveal" aria-hidden="true">
              <div className="lp-terminal-bar"><span /><span /><span /><em>dataLayer</em></div>
              <pre>
                <span className="c">// pushed on submit</span>{'\n'}
                {'{'}{'\n'}
                {'  '}<span className="a">event</span>: <span className="s">'openflow_submit'</span>,{'\n'}
                {'  '}<span className="a">formTitle</span>: <span className="s">'Project inquiry'</span>,{'\n'}
                {'  '}<span className="a">eventId</span>: <span className="s">'8f3c…e21a'</span>,{'\n'}
                {'}'}{'\n'}{'\n'}
                <span className="c">// sent server-side</span>{'\n'}
                <span className="t">→</span> Meta CAPI   <span className="ok">Lead · 200</span>{'\n'}
                <span className="t">→</span> Google Ads  <span className="ok">conversion · 200</span>
              </pre>
            </div>
          </div>
        </section>

        <section className="lp-section" id="self-host">
          <div className="lp-container">
            <div className="lp-section-head lp-reveal">
              <div className="lp-eyebrow">// Self-host</div>
              <h2>One container. Up in a minute.</h2>
              <p className="lp-section-sub">SQLite, scheduled backups and a multi-arch image on GHCR. No external database, no Redis, no vendor lock-in.</p>
            </div>
            <div className="lp-install lp-reveal">
              <div className="lp-install-code">
                <div className="lp-terminal-bar"><span /><span /><span /><em>terminal</em><CopyButton text={QUICK_START.join('\n')} label="Copy install commands" /></div>
                <pre>
                  {QUICK_START.map(line => (
                    <div key={line}><span className="lp-prompt">$</span> {line}</div>
                  ))}
                  <div className="lp-install-out">✓ openflow is running on http://localhost:3000</div>
                </pre>
              </div>
              <div className="lp-stats">
                <div><b>1</b><span>container</span></div>
                <div><b>15</b><span>field types</span></div>
                <div><b>6</b><span>integrations</span></div>
                <div><b>0</b><span>monthly fees</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-cta-glow" aria-hidden="true" />
          <div className="lp-container lp-cta-inner lp-reveal">
            <LogoMark size={44} />
            <h2>Own your funnel.</h2>
            <p>Free and open source, on your own infrastructure.</p>
            <div className="lp-actions">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-primary"><GitHubIcon /> View on GitHub</a>
              <Link to="/login" className="lp-btn lp-btn-ghost">Sign in <Arrow /></Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-brand"><LogoMark size={18} /><LogoWordmark /></div>
          <nav>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href={`${GITHUB_URL}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">Changelog</a>
            <a href={`${GITHUB_URL}/blob/main/ROADMAP.md`} target="_blank" rel="noopener noreferrer">Roadmap</a>
            <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">GPL-3.0</a>
            <Link to="/login">Sign in</Link>
          </nav>
          <span className="lp-footer-meta">{version ? `v${version} · ` : ''}by vidual labs</span>
        </div>
      </footer>
    </div>
  );
}
