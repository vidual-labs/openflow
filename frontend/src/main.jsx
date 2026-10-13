import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import FormView from './pages/FormView';
import EmbedView from './pages/EmbedView';
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
