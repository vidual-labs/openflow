<sub>[← README](../README.md) · [All docs](README.md)</sub>

# Development

Requires **Node.js 20+** (the Docker image and CI use Node 20).

```bash
# Start backend
cd backend && npm install && npm run dev

# Start frontend (in new terminal)
cd frontend && npm install && npm run dev
```

Frontend dev server: `http://localhost:5173` (proxies API to port 3000)

Run the backend test suite (Jest + supertest):

```bash
cd backend && npm test
```

## 🏗️ Architecture

```
openflow/
├── backend/                        # 🟢 Express API + SQLite (also serves the built frontend)
│   ├── src/
│   │   ├── index.js                # Server entry point, CORS, SPA fallback
│   │   ├── models/                 # DB schema, integrations engine, delivery queue,
│   │   │                           #   backups, API tokens, rate limiting
│   │   ├── middleware/             # Session + API-token auth, security headers, per-form subdomain routing
│   │   ├── routes/                 # auth, forms, submissions, public, integrations,
│   │   │                           #   analytics, settings, admin
│   │   └── utils/                  # slug/subdomain rules, CSS sanitizer, SSRF guard
│   └── tests/                      # Jest + supertest
├── frontend/                       # ⚛️ React (Vite)
│   └── src/
│       ├── main.jsx                # /f/:slug, /embed/:slug, and the admin SPA
│       ├── components/             # FormRenderer, IntegrationsPanel, shared admin UI
│       ├── pages/                  # Admin pages + public form/embed views
│       ├── locales.js              # Respondent-facing strings (EN / DE)
│       ├── autofill.js             # Browser-autofill tokens + the editor's autofill tip
│       ├── clickIds.js             # Ad click-ID capture (gclid/gbraid/wbraid, fbclid)
│       └── styles/                 # CSS
├── wordpress-plugin/               # 🔌 WordPress integration
│   └── openflow/
│       ├── openflow.php            # Shortcode + WPBakery + Gutenberg
│       └── block.js                # Gutenberg block editor
├── docs/integrations/              # 📚 Per-integration setup walkthroughs
├── Dockerfile                      # Multi-stage: builds the frontend into the backend image
├── docker-compose.yml
├── docker-compose.subdomains.yml   # Optional Caddy overlay for custom subdomains
└── Caddyfile
```

Contributor-level detail (patterns, conventions, versioning) is in [CLAUDE.md](../CLAUDE.md).
