import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import FormRenderer from '../components/FormRenderer';
import { api } from '../api';

export default function FormView() {
  const { slug } = useParams();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPublicForm(slug).then(d => setForm(d.form)).catch(e => setError(e.message));
  }, [slug]);

  useEffect(() => {
    if (form?.gtm_id) {
      // Inject GTM
      const script = document.createElement('script');
      script.innerHTML = `
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','${form.gtm_id}');
      `;
      document.head.appendChild(script);
      return () => document.head.removeChild(script);
    }
  }, [form?.gtm_id]);

  if (error) return <div style={{ padding: 40, textAlign: 'center' }}><h2>Form not found</h2></div>;
  if (!form) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return <FormRenderer form={form} onSubmit={(data) => api.submitForm(slug, data)} />;
}
