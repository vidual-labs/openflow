import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FormRenderer from '../components/FormRenderer';
import { api } from '../api';

function CookieBanner({ form, onAccept, onDecline }) {
  const es = form.end_screen || {};
  const text = es.cookieConsentText || 'We use Google Tag Manager to analyze form interactions and improve your experience. Do you accept?';
  const acceptLabel = es.cookieConsentAcceptLabel || 'Accept';
  const declineLabel = es.cookieConsentDeclineLabel || 'Decline';
  const primary = form.theme?.primaryColor || '#6C5CE7';

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: '#fff', borderTop: '1px solid #e0e0e0',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.10)',
      padding: '16px 24px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <p style={{ margin: 0, fontSize: 14, color: '#2D3436', lineHeight: 1.5 }}>{text}</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onAccept}
          style={{
            background: primary, color: '#fff', border: 'none',
            padding: '9px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {acceptLabel}
        </button>
        <button
          onClick={onDecline}
          style={{
            background: 'none', color: '#636E72', border: '1px solid #ccc',
            padding: '9px 20px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
          }}
        >
          {declineLabel}
        </button>
      </div>
    </div>
  );
}

export default function FormView({ slugProp, hostMode = false }) {
  const params = useParams();
  const slug = slugProp || params.slug;
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  // null = not yet determined, true = accepted, false = declined, 'pending' = needs banner
  const [cookieConsent, setCookieConsent] = useState(null);
  const [clickIds, setClickIds] = useState({});

  // Force light theme on public form pages (dark mode is admin-only)
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => {
      if (prev) root.setAttribute('data-theme', prev);
      else root.removeAttribute('data-theme');
    };
  }, []);

  useEffect(() => {
    api.getPublicForm(slug)
      .then(d => {
        // On a per-form subdomain the canonical URL is just "/" — never
        // navigate away from it even after a slug rename.
        if (!hostMode && d.form && d.form.slug && d.form.slug !== slug) {
          navigate(`/f/${d.form.slug}`, { replace: true });
          return;
        }
        setForm(d.form);
      })
      .catch(e => setError(e.message));
  }, [slug, navigate, hostMode]);

  // Determine cookie consent state once form is loaded. This gates both GTM
  // injection and ad click-ID capture (gclid/gbraid/wbraid), so it no longer
  // short-circuits on gtm_id alone.
  useEffect(() => {
    if (!form) return;
    if (!form.end_screen?.cookieConsentEnabled) { setCookieConsent(true); return; }
    const stored = localStorage.getItem(`of_cc_${form.id}`);
    if (stored === 'accepted') { setCookieConsent(true); }
    else if (stored === 'declined') { setCookieConsent(false); }
    else { setCookieConsent('pending'); }
  }, [form]);

  // Capture Google Ads click IDs from the landing URL, once consent allows
  // it, so they can ride along with the submission for server-side
  // conversion upload.
  useEffect(() => {
    if (cookieConsent !== true) return;
    const params = new URLSearchParams(window.location.search);
    const ids = {};
    ['gclid', 'gbraid', 'wbraid'].forEach(key => {
      const value = params.get(key);
      if (value) ids[key] = value;
    });
    if (Object.keys(ids).length) setClickIds(ids);
  }, [cookieConsent]);

  // Inject GTM only when consent is given
  useEffect(() => {
    if (!form?.gtm_id || cookieConsent !== true) return;
    if (!/^GTM-[A-Z0-9]+$/.test(form.gtm_id)) return;
    const script = document.createElement('script');
    script.innerHTML = `
      (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
      new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
      j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
      'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
      })(window,document,'script','dataLayer','${form.gtm_id}');
    `;
    document.head.appendChild(script);
    return () => { if (document.head.contains(script)) document.head.removeChild(script); };
  }, [form?.gtm_id, cookieConsent]);

  function handleAccept() {
    localStorage.setItem(`of_cc_${form.id}`, 'accepted');
    setCookieConsent(true);
  }
  function handleDecline() {
    localStorage.setItem(`of_cc_${form.id}`, 'declined');
    setCookieConsent(false);
  }

  if (error) return <div style={{ padding: 40, textAlign: 'center' }}><h2>Form not found</h2></div>;
  if (!form) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <>
      <FormRenderer form={form} onSubmit={(data) => api.submitForm(slug, data, clickIds)} />
      {cookieConsent === 'pending' && (
        <CookieBanner form={form} onAccept={handleAccept} onDecline={handleDecline} />
      )}
    </>
  );
}
