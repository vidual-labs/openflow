import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import FormView from './pages/FormView';
import EmbedView from './pages/EmbedView';
// Space Grotesk ships with the app instead of coming from Google Fonts: the
// admin uses it for the logo wordmark, the landing page for its headings, and
// public forms when the operator picks it in the Design tab. The browser only
// downloads a weight (and subset) once something on the page uses it.
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './styles/global.css';

// If the backend served this page on a per-form subdomain it injects the
// form identity into window.__OPENFLOW_HOST_FORM__. In that case we bypass
// the normal admin SPA and serve only the form — every path renders FormView
// for the bound slug.
const hostForm = typeof window !== 'undefined' ? window.__OPENFLOW_HOST_FORM__ : null;

const root = (
  <React.StrictMode>
    <BrowserRouter>
      {hostForm && hostForm.slug ? (
        <Routes>
          <Route path="*" element={<FormView slugProp={hostForm.slug} hostMode />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/f/:slug" element={<FormView />} />
          <Route path="/embed/:slug" element={<EmbedView />} />
          <Route path="/*" element={<App />} />
        </Routes>
      )}
    </BrowserRouter>
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById('root')).render(root);
