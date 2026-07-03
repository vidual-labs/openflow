const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { version } = require('../package.json');
const { initDb } = require('./models/db');
const authRoutes = require('./routes/auth');
const formRoutes = require('./routes/forms');
const submissionRoutes = require('./routes/submissions');
const publicRoutes = require('./routes/public');
const integrationRoutes = require('./routes/integrations');
const analyticsRoutes = require('./routes/analytics');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');
const { createSubdomainMiddleware } = require('./middleware/subdomain');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust X-Forwarded-* headers only when this deployment is fronted by a
// reverse proxy (subdomain routing requires one). Trusting in unproxied
// setups would let any client spoof req.ip via X-Forwarded-For.
if (process.env.OPENFLOW_PRIMARY_HOST) {
  app.set('trust proxy', 1);
}

// The frontend is served by this same app (or proxied same-origin in dev via
// Vite, or behind a reverse proxy in production), so browser requests don't
// need cross-origin CORS at all in the common case. Reflecting any Origin
// with credentials: true would let any third-party site make authenticated
// (cookie-carrying) requests against the API, so we don't do that — but a
// request whose Origin host matches the Host this server received is
// genuinely same-origin from the browser's perspective (that's what the dev
// proxy and any same-service production deployment look like) and must
// always be allowed, or the app breaks out of the box. Anything else is
// only allowed if explicitly configured.
//
// Written by hand (not the `cors` package) because its origin-callback only
// receives the Origin header, not the request's Host, so it can't make this
// same-origin comparison — and because a rejected request must NOT throw
// (that crashes to Express's HTML error page instead of a JSON response).
const allowedOrigins = [process.env.OPENFLOW_PRIMARY_HOST, ...(process.env.CORS_ORIGINS || '').split(',')]
  .map(o => o && o.trim())
  .filter(Boolean)
  .flatMap(o => (o.startsWith('http://') || o.startsWith('https://')) ? [o] : [`http://${o}`, `https://${o}`]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { originHost = null; }
    const allowed = originHost === req.headers.host || allowedOrigins.includes(origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type,Authorization');
    return res.sendStatus(204);
  }
  next();
});
// Most JSON bodies are small (form config, integration config, credentials).
// Two routes legitimately need much more: public submissions can embed
// base64-encoded file uploads, and admin backup/restore ships the whole DB.
// Give those a large limit and everything else a small one, so an
// unauthenticated caller can't exhaust memory/bandwidth by POSTing huge
// bodies to lightweight endpoints.
app.use('/api/public/form/:slug/submit', express.json({ limit: '50mb' }));
app.use('/api/admin/restore', express.json({ limit: '50mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Resolve the per-form subdomain (if any) before any other route runs so
// admin APIs can be blocked and the catch-all can inject the form slug
// into index.html.
app.use(createSubdomainMiddleware());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);

// API 404 handler (must come before static file serving)
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve frontend
const fs = require('fs');
const publicDir = path.join(__dirname, '../public');
// Disable static's automatic index.html serving so the catch-all below can
// inject window.__OPENFLOW_HOST_FORM__ on subdomain hosts. Other assets
// (JS, CSS, images) still get served by the static middleware.
app.use(express.static(publicDir, { index: false }));

// Cache the unmodified index.html bytes so we don't hit disk on every SPA route.
let cachedIndexHtml = null;
function readIndexHtml() {
  if (cachedIndexHtml !== null) return cachedIndexHtml;
  const indexPath = path.join(publicDir, 'index.html');
  if (!fs.existsSync(indexPath)) return null;
  cachedIndexHtml = fs.readFileSync(indexPath, 'utf8');
  return cachedIndexHtml;
}

function escapeForJsString(s) {
  // Only safe characters end up here (slugs are [a-z0-9-]), but escape
  // defensively so a future change can't smuggle JS into the page.
  return String(s).replace(/[\\'"<>&]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function injectSubdomainForm(html, form) {
  const payload = `{"slug":"${escapeForJsString(form.slug)}","id":"${escapeForJsString(form.id)}"}`;
  const tag = `<script>window.__OPENFLOW_HOST_FORM__=${payload};</script>`;
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`);
  return tag + html;
}

app.get('*', (req, res) => {
  const html = readIndexHtml();
  if (!html) {
    return res.status(200).json({ status: 'OpenFlow API running', version });
  }
  if (req.subdomainForm) {
    return res.type('html').send(injectSubdomainForm(html, req.subdomainForm));
  }
  res.type('html').send(html);
});

async function start() {
  try {
    initDb();
    console.log('Database initialized');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenFlow running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
