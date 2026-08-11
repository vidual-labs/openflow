# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OpenFlow** is an open-source, self-hosted form builder for lead generation. It's a Typeform/Heyflow alternative with a multi-step form builder, conditional logic, integrations (webhooks, email, Google Sheets, Google Ads), analytics, and a WordPress plugin.

**Current Version**: 0.25.1 (see version badge in README.md and CHANGELOG.md)

## Architecture

OpenFlow is a **full-stack application** with three main components:

### Backend (Express + SQLite)
- **Location**: `backend/src/`
- **Technology**: Node.js + Express.js + SQLite (better-sqlite3)
- **Key Files**:
  - `index.js` — Server entry point, CORS, route initialization, SPA fallback
  - `models/db.js` — Database schema, migrations, first-boot admin seeding
  - `models/integrations.js` — Integration engine (webhooks, email, Google Sheets, Google Ads)
  - `models/deliveryQueue.js` — Persists each integration delivery and retries it with backoff
  - `models/backup.js` / `models/backupScheduler.js` — JSON backup/restore + the rotating scheduled backup job
  - `models/apiTokens.js` — Read-only `ofw_` API tokens (hashed at rest)
  - `models/rateLimit.js` — In-memory rate limiter
  - `middleware/auth.js` — JWT + API-token authentication, `requireAdmin`, `requireSession`
  - `middleware/subdomain.js` — Resolves per-form subdomains and blocks admin paths on them
  - `routes/` — API endpoints (auth, forms, submissions, public, integrations, analytics, settings, admin)
  - `utils/` — `steps.js` (flattens combined steps), `slug.js`, `subdomain.js`, `sanitizeCss.js`, `ssrf.js`
- **Database**: SQLite stored in Docker volume (`db-data`) for persistence
- **Key Features**: Rate limiting, JWT auth, read-only API tokens, HMAC-signed webhooks, SMTP email, Google Sheets/Ads integrations, retrying deliveries, analytics tracking, backup & restore

### Frontend (React + Vite)
- **Location**: `frontend/src/`
- **Technology**: React 18 + Vite + React Router
- **Key Files**:
  - `main.jsx` — Route split: `/f/:slug`, `/embed/:slug`, everything else the admin SPA (plus per-form subdomain mode)
  - `App.jsx` — Admin shell (sidebar, auth gate, theme toggle)
  - `pages/FormEditor.jsx` — Form builder UI (`FIELD_TYPES` lives here; steps, end screen, design, GTM/GDPR, integrations, embed tabs)
  - `pages/FormView.jsx` — Public form page at `/f/:slug` (landing page, GTM, cookie banner)
  - `pages/EmbedView.jsx` — Iframe-optimized form page at `/embed/:slug` (posts resize messages)
  - `pages/Dashboard.jsx` — Form list (create, duplicate, publish, delete)
  - `pages/Analytics.jsx` — Funnel and drop-off analysis
  - `pages/Submissions.jsx` — View, delete and export submissions
  - `pages/Users.jsx` / `pages/Settings.jsx` / `pages/Backup.jsx` — Admin-only pages (users, branding + API tokens, backup/restore)
  - `components/FormRenderer.jsx` — Renders forms with animations, validation, conditional logic and consent
  - `components/IntegrationsPanel.jsx` — Configure integrations per form
  - `components/AdminUI.jsx` — Shared page header, alert, empty/loading components
  - `locales.js` — Built-in respondent-facing UI strings (EN / DE)
- **API Client**: `api.js` — Wrapper for backend API calls
- **Dev Server**: Vite with proxy to backend (port 3000)

### WordPress Plugin
- **Location**: `wordpress-plugin/openflow/`
- **Features**: Shortcode `[openflow]`, WPBakery element, Gutenberg block
- **Key Files**: `openflow.php`, `block.js`, `readme.txt`
- **Versioning**: The plugin carries its **own** version (`OPENFLOW_VERSION` in `openflow.php` + the `Stable tag` in `readme.txt`), independent of the app version

### Infrastructure
- **Docker**: A single `app` service in `docker-compose.yml`. The multi-stage `Dockerfile` builds the frontend and copies `dist/` into the backend's `public/`, so one container serves both the API and the UI.
- **Optional overlay**: `docker-compose.subdomains.yml` + `Caddyfile` add a Caddy reverse proxy that terminates TLS with a wildcard cert, for per-form subdomains
- **Database**: SQLite (zero-config, no external DB)
- **Volumes**: `db-data` (the SQLite DB) and a `./backups` bind mount (scheduled backups)
- **Deployment**: Docker Compose (one-command deployment)

## Development Setup

### Start Backend
```bash
cd backend
npm install
npm run dev
```
Server runs on `http://localhost:3000`. The backend serves the API and hosts the compiled frontend.

### Start Frontend (separate dev server)
```bash
cd frontend
npm install
npm run dev
```
Dev server on `http://localhost:5173` with hot reload. Proxies API requests to backend.

### With Docker
```bash
docker compose up -d --build
# Access at http://localhost:3000
# Default login: admin@openflow.local / admin123
```
`docker-compose.yml` supplies `admin123` as the fallback `ADMIN_PASSWORD`. Running
the backend **without** those compose defaults generates a random one-time admin
password and prints it to the server log on first boot instead.

## Key Development Patterns

### Form Structure (Backend)
A form row in `forms` holds everything as JSON columns — there is no separate
fields table:
- **`steps`**: Array of steps, each with field type, label, placeholder, validation, etc. A step is normally one field; two adjacent questions can be merged into a `{ type: 'group', fields: [a, b] }` step. Use `utils/steps.js#flattenFields` before touching leaf fields.
- **`theme`**: Colors, fonts, animated backgrounds, button position, custom CSS, language
- **`end_screen`**: Thank-you content, auto-redirect, GDPR consent settings, cookie-banner settings
- **`gtm_id`**: GTM container id (validated as `GTM-XXXXXXX`, since it is interpolated into a raw `<script>` tag)
- **Integrations**: Rows in the `integrations` table, keyed by `form_id`
- **Landing Page**: Optional logo, headline, subline, footer links (in `theme`)
- **Conditional Logic**: Show/hide rules based on previous answers (stored in step config)

### Form Field Types
14 types the builder can add (`FIELD_TYPES` in `frontend/src/pages/FormEditor.jsx`):
Short Text, Long Text, Number, Date, Single Choice, Multiple Choice, Yes/No,
Rating, Image/Icon Select, File Upload, Email, Phone, Website URL, Address. Each
has validation, placeholder, help text, and conditional visibility.

**Consent/GDPR is not a field type** — it's a form-level setting (**GTM / GDPR**
tab) that either appends a checkbox under the last question or adds a synthetic
final step (`CONSENT_STEP_ID` in `FormRenderer.jsx`). It arrives in the
submission as `_consent: true`. A `consent` *field* type is still rendered for
backwards compatibility with forms built before this moved.

### Integration Engine (`models/integrations.js`)
Handles all outbound data flows via `runIntegration()`'s switch on
`integration.type`:
- **`webhook`**: POST/PUT with optional HMAC-SHA256 signing in `X-OpenFlow-Signature`. ⚠️ Known bug: the digest is computed over `{formId, formTitle, data, timestamp: Date.now()}` while the body sent is `{event, formId, formTitle, data, timestamp: <ISO>}`, so receivers can never verify it. Sign the exact bytes being sent when fixing — and treat it as a breaking change for anyone who worked around it.
- **`email`**: SMTP with HTML-formatted submission table (values HTML-escaped)
- **`google_sheets`**: Both Sheets variants share this type and branch on `config.mode` — `apps_script` (URL only) or `service_account` (JSON key, auto-creates headers). The UI's `google_sheets_sa` option is mapped to `google_sheets` before saving.
- **`google_ads_conversion`**: Offline conversion upload via the Data Manager API; only runs for submissions carrying a `gclid`/`gbraid`/`wbraid`

Each integration has an enabled flag and a test endpoint
(`POST /api/integrations/:formId/:id/test`). Google Ads is special-cased there:
its test only validates OAuth credentials via `testGoogleAdsCredentials()`
instead of uploading a fake conversion. Deliveries go through
`models/deliveryQueue.js`, which persists an `integration_deliveries` row per
attempt and retries with backoff before marking it dead.

### Analytics
Tracks per-form and global stats: views, starts, completions, conversion rates,
step drop-off. Data stored in the `analytics_events` table.

## Testing

```bash
# Backend tests (Jest)
cd backend
npm test

# Run single test file
npm test -- auth.test.js

# Watch mode
npm test -- --watch
```

Tests live in `backend/tests/` and cover: authentication, authorization, API
tokens, rate limiting, form CRUD, submission validation, slug rules, subdomain
rules, and backup/restore. There is no frontend test suite.

## Version Management

**Important**: Every commit must include a version bump.

Version files to update:
1. **README.md** — Update badge: `# 🌊 OpenFlow v0.X.X`
2. **CHANGELOG.md** — Add new entry with date and changes
3. **backend/package.json** + **backend/package-lock.json** — Update `version` (twice in the lockfile: the root and the `""` package entry)
4. **frontend/package.json** + **frontend/package-lock.json** — Same
5. **CLAUDE.md** — Update "Current Version" at the top of this file

Nothing else needs touching: the admin sidebar reads the version from
`frontend/package.json` and `GET /api/` reads it from `backend/package.json`,
so neither can go stale. The WordPress plugin is versioned separately.

**Version Format**: Semantic versioning (e.g., 0.7.4)
- Patch (0.7.4 → 0.7.5): Bug fixes
- Minor (0.7.0 → 0.8.0): New features
- Major (1.0.0): Breaking changes

## Database Schema

Defined in one `CREATE TABLE IF NOT EXISTS` block plus additive `ALTER TABLE`
migrations in `models/db.js`:

- `users` — Admin/editor users (email, hashed password, role)
- `forms` — Everything about a form: `steps`, `end_screen`, `theme` (JSON text columns), `slug`, `gtm_id`, `published`. Steps are **not** a separate table.
- `submissions` — User responses (`data` + `metadata` JSON, keyed by field id)
- `integrations` — Integration configs per form (`type`, `enabled`, `config` JSON)
- `analytics_events` — Analytics events (view, start, step, complete) with `session_id`, `step_index`, `step_id`
- `integration_deliveries` — One row per delivery attempt (status, attempts, `next_attempt_at`, `last_error`) backing retries and dead letters
- `api_tokens` — Read-only API tokens (SHA-256 `token_hash`, `token_prefix`, `last_used_at`)
- `slug_history` — Old slugs of renamed forms, so previously shared links keep resolving
- `site_settings` — Global key/value settings (currently just `branding`)

## API Structure

- **Public** (`/api/public/`): No auth required. Load form, submit response, track analytics.
- **Admin** (`/api/forms`, `/api/submissions`, `/api/auth`): JWT auth required (`router.use(authMiddleware)`).
- **Integrations** (`/api/integrations`): Test, create, update, delete integrations; list and retry deliveries.
- **Analytics** (`/api/analytics`): Get funnel and trend data.
- **Settings** (`/api/settings`): `GET` is public (branding + `primaryHost` are needed by the login screen and form editor); `PUT /:key` is admin-only and restricted to an allowlist of keys.
- **Admin-only** (`/api/admin/`): Backup, restore, and scheduled-backup listing. The whole router is behind `authMiddleware, requireAdmin`, and it is blocked outright on per-form subdomains.

### External consumer: lodgely (lead intake hub)

[lodgely](https://github.com/vidual-labs/lodgely) has a built-in OpenFlow
connector that **pulls** submissions out of an install — it is not a push
integration configured here, but it does depend on this API's shape:

- **Auth (preferred): an API token.** A logged-in user mints a read-only token
  under **Settings → API Tokens** (`POST /api/auth/tokens`), and lodgely sends
  it as a `Bearer` token. See "API tokens" below.
- **Auth (fallback): login.** lodgely can still log in via `POST /api/auth/login`
  (email + password) and read the JWT from the **`token` httpOnly cookie**, then
  send it as a `Bearer` token. **Don't remove the Set-Cookie token or stop
  accepting the Bearer header without coordinating.**
- It reads `GET /api/forms` (to list forms), `GET /api/forms/:id` (to read
  `steps` for field mapping) and `GET /api/submissions/:formId` (paged, newest
  first) where each submission's `data` is keyed by field id. Changing those
  response shapes is a breaking change for the connector.

### API tokens

`backend/src/models/apiTokens.js` + the `/api/auth/tokens` routes implement
long-lived, **read-only** API tokens (format `ofw_<40 hex>`). Only a SHA-256
hash is stored; the plaintext is shown once at creation. The auth middleware
(`middleware/auth.js`) recognises a token by its `ofw_` prefix, authenticates
the owning user, and **rejects any non-GET/HEAD request** (`req.authVia ===
'api_token'`). `requireSession` blocks token-authed callers from the
token-management endpoints, so a token can never mint or list tokens. Tokens are
managed in the UI under **Settings → API Tokens**.

## Common Tasks

### Add a New Field Type
1. Add an entry to `FIELD_TYPES` in `frontend/src/pages/FormEditor.jsx` (value, label, icon, smart defaults) plus any type-specific config UI
2. Add a renderer + client-side validation in `frontend/src/components/FormRenderer.jsx` (`INPUTS` map and `validateField`), and add it to `AUTO_ADVANCE_FIELDS` if it should advance on click
3. Add respondent-facing strings to `frontend/src/locales.js` for every language
4. If the server needs to enforce more than "required and non-empty", extend the validation loop in `backend/src/routes/public.js` (`POST /form/:slug/submit`)
5. Test in FormEditor, FormView and EmbedView

### Add a New Integration
1. Add a `case` to `runIntegration()` in `backend/src/models/integrations.js` and a `run<Name>()` that **throws** on failure, so the delivery queue can retry it
2. Add the type to `INTEGRATION_TYPES` and a config form in `frontend/src/components/IntegrationsPanel.jsx`
3. If the integration fetches a user-supplied URL, run it through `utils/ssrf.js#assertSafeUrl`
4. Special-case the test path in `backend/src/routes/integrations.js` if a synthetic submission can't safely be sent for real

### Deploy
```bash
git pull
docker compose up -d --build
# Data persists in db-data volume
```

### Reset Database
```bash
docker compose down -v  # Removes db-data volume
docker compose up -d --build
```

## Important Notes

- **SQLite**: All data is in the SQLite database. The Docker volume `db-data` persists data across restarts; scheduled backups go to the separate `./backups` bind mount so a lost `db-data` volume doesn't take them with it.
- **Rate Limiting**: In-memory rate limiter in `models/rateLimit.js` (no external Redis). Resets on restart.
- **HMAC Signing**: Webhooks can be signed with a shared secret for security.
- **Conditional Logic**: Stored as rules array in field config. Evaluated client-side during form render — the server does not re-check visibility, only that required fields are non-empty.
- **Form Slugs**: Unique URL identifier for public form access (`/f/<slug>` and `/embed/<slug>`). Renaming a slug archives the old one in `slug_history` so old links still resolve.
- **Multi-User**: Admin can invite users and assign roles. Role-based access control in `middleware/auth.js`.
- **Secrets**: `JWT_SECRET` is auto-generated and persisted next to the DB when unset; there is no hardcoded fallback. Set it explicitly in production.
- **Untrusted input into HTML**: GTM ids, custom CSS and emailed field values all pass through validation/sanitization (`validateGtmId`, `utils/sanitizeCss.js`, `escapeHtmlAttr`). Keep it that way when touching those paths.

## Conventions

- **Form IDs / submission IDs / user IDs**: UUID v4
- **Form slugs**: 8-char nanoid over `[a-z0-9]`, editable afterwards
- **Field IDs**: generated in the editor as `field_<timestamp>` (`group_…` for combined steps, `custom_…` for address sub-fields). They are opaque — never parse them.
- **Naming**: camelCase in JavaScript, snake_case in SQL/database
- **Colors**: Hex format (e.g., `#FF5733`)
- **Timestamps**: SQLite `datetime('now')` (UTC, `YYYY-MM-DD HH:MM:SS`) for row defaults; submission `metadata.submittedAt` is a full ISO 8601 string
