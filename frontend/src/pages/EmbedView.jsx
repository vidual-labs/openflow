import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
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

export default function EmbedView() {
  const { slug } = useParams();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [cookieConsent, setCookieConsent] = useState(null);

  // Force light theme on embedded form pages (dark mode is admin-only)
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
    api.getPublicForm(slug).then(d => setForm(d.form)).catch(e => setError(e.message));
  }, [slug]);

  // Determine cookie consent state once form is loaded
  useEffect(() => {
    if (!form) return;
    if (!form.gtm_id) { setCookieConsent(null); return; }
    if (!form.end_screen?.cookieConsentEnabled) { setCookieConsent(true); return; }
    const stored = localStorage.getItem(`of_cc_${form.id}`);
    if (stored === 'accepted') { setCookieConsent(true); }
    else if (stored === 'declined') { setCookieConsent(false); }
    else { setCookieConsent('pending'); }
  }, [form]);

  // Inject GTM only when consent is given
  useEffect(() => {
    if (!form?.gtm_id || cookieConsent !== true) return;
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

  // Notify parent iframe of height changes for auto-resize
  useEffect(() => {
    function sendHeight() {
      const height = document.body.scrollHeight;
      window.parent.postMessage({ type: 'openflow-resize', height }, '*');
    }
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.body);
    sendHeight();
    return () => observer.disconnect();
  }, []);

  if (error) return <div style={{ padding: 40, textAlign: 'center' }}>Form not found</div>;
  if (!form) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <>
      <FormRenderer form={form} onSubmit={(data) => api.submitForm(slug, data)} embedded />
      {cookieConsent === 'pending' && (
        <CookieBanner form={form} onAccept={handleAccept} onDecline={handleDecline} />
      )}
    </>
  );
}
