# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OpenFlow** is an open-source, self-hosted form builder for lead generation. It's a Typeform/Heyflow alternative with a multi-step form builder, conditional logic, integrations (webhooks, email, Google Sheets, Google Ads, Meta Conversions API), analytics, and a WordPress plugin. Planned work lives in `ROADMAP.md` (including the shared cross-repo contract with lodgely).

**Current Version**: 0.46.0 (see CHANGELOG.md; the README version badge reads `backend/package.json` via shields.io)

## Architecture

OpenFlow is a **full-stack application** with three main components:

### Backend (Express + SQLite)
- **Location**: `backend/src/`
- **Technology**: Node.js + Express.js + SQLite (better-sqlite3)
- **Key Files**:
  - `index.js` — Server entry point, CORS, route initialization, SPA fallback
  - `models/db.js` — Database schema, migrations, first-boot admin seeding
  - `models/integrations.js` — Integration engine (webhooks, email, Google Sheets, Google Ads, Meta Conversions API)
  - `models/secureDefaults.js` — Refuses a weak seed `ADMIN_PASSWORD` at boot, the weak/guessable-password rules (`isWeakPassword`, `isAcceptableNewPassword`), flags accounts still on a weak password (admin UI banner)
  - `models/sessions.js` — Server-side login sessions (`token` cookie, 7 days) and remembered browsers (`of_dev_<hash>` cookie, 30 days, path `/api/auth`); only SHA-256 hashes of tokens are stored
  - `models/loginGuard.js` — Persistent per-e-mail lockout after failed logins (1/5/15/60 min every 5 failures); remembered browsers are exempt
  - `models/twoFactor.js` — E-mailed one-time codes (opt-in two-factor login, confirming 2FA); `OPENFLOW_2FA_DISABLED` escape hatch
  - `models/systemMail.js` — OpenFlow's own outgoing mail (login codes, security notices); separate from the per-form email integration. `SMTP_*` env wins (UI read-only); otherwise the admin UI's settings, stored encrypted as the `smtp` row of `site_settings` (password write-only; a UI host passes `integrations.js#smtpTarget`)
  - `models/passwords.js` — Async bcrypt (cost `BCRYPT_ROUNDS`, default 12), dummy-hash timing equalisation, rehash-on-login
  - `models/auditLog.js` — Security audit trail (logins, user/role changes, settings, backup/restore)
  - `models/deliveryQueue.js` — Persists each integration delivery and retries it with backoff
  - `models/backup.js` / `models/backupScheduler.js` — JSON backup/restore + the rotating scheduled backup job
  - `models/apiTokens.js` — Read-only `ofw_` API tokens (hashed at rest)
  - `models/encryption.js` / `models/integrationSecrets.js` — AES-256-GCM for integration configs; which config fields are write-only secrets (redacted from every API response, merged on update)
  - `models/rateLimit.js` — In-memory rate limiter
  - `middleware/auth.js` — Session + API-token authentication, `requireAdmin`, `requireSession`
  - `middleware/securityHeaders.js` — Strict CSP + `X-Frame-Options: DENY` for admin pages, none for public form pages (`/f/`, `/embed/`, subdomains — GTM/Pixel/iframes); nosniff, referrer policy, HSTS over HTTPS
  - `middleware/subdomain.js` — Resolves per-form subdomains and blocks admin paths on them
  - `routes/` — API endpoints (auth, forms, submissions, public, integrations, analytics, settings, admin). `routes/account.js` (mounted inside `auth.js`) is the self-service part: own password, 2FA, sessions, remembered browsers
  - `utils/` — `steps.js` (flattens combined steps), `fieldKeys.js` (stable field keys + key-based condition references), `conditions.js` (server mirror of the renderer's show/hide logic), `slug.js`, `subdomain.js`, `sanitizeCss.js`, `ssrf.js`
- **Database**: SQLite stored in Docker volume (`db-data`) for persistence
- **Key Features**: Rate limiting, server-side sessions with opt-in e-mail 2FA and account lockout, read-only API tokens, HMAC-signed webhooks, SMTP email, Google Sheets/Ads integrations, retrying deliveries, analytics tracking, backup & restore

### Frontend (React + Vite)
- **Location**: `frontend/src/`
- **Technology**: React 18 + Vite + React Router
- **Key Files**:
  - `main.jsx` — Route split: `/f/:slug`, `/embed/:slug`, everything else the admin SPA (plus per-form subdomain mode)
  - `App.jsx` — Admin shell (sidebar: Forms, Analytics, an admin-only "Administration" section with Users/Settings/Backup, and the account footer — e-mail → `/account`, theme toggle, log out; auth gate)
  - `pages/FormEditor.jsx` — Form builder UI (`FIELD_TYPES` lives here; steps, end screen, design, GTM/GDPR, integrations, embed tabs)
  - `pages/FormView.jsx` — Public form page at `/f/:slug` (landing page, GTM, cookie banner)
  - `pages/EmbedView.jsx` — Iframe-optimized form page at `/embed/:slug` (posts resize messages)
  - `pages/Landing.jsx` (+ `Landing.css`, `components/LandingBackground.jsx`) — Marketing landing page shown at `/` to logged-out visitors when `OPENFLOW_LANDING_PAGE=true` (read via `GET /api/settings` → `landingPage`); login then lives at `/login`. Lazy-loaded, always dark, styles scoped under `.lp`
  - `pages/Dashboard.jsx` — Form list (create, duplicate, publish, delete)
  - `pages/Analytics.jsx` — Analytics overview: all forms vs. the previous period
  - `pages/FormAnalytics.jsx` — Per-form analytics at `/analytics/:formId`: period + comparison range (in the URL), a "changed the flow on…" before/after shortcut, per-step reach / drop-off / median time on step, daily trend. Shared bits (`Delta`, `Kpi`, UTC day helpers) in `components/AnalyticsUI.jsx`
  - `pages/Submissions.jsx` — View, delete and export submissions
  - `pages/Users.jsx` / `pages/Settings.jsx` / `pages/Backup.jsx` — Admin-only pages (users incl. 2FA reset, branding + system e-mail / SMTP form, backup/restore)
  - `pages/Account.jsx` — Every user's own page: change password, two-factor login, active sessions, remembered browsers, API tokens (`ApiTokensCard` lives in `Settings.jsx`)
  - `pages/Login.jsx` — Password step, then (2FA accounts on a new browser) the e-mailed-code step with "remember this browser"
  - `components/FormRenderer.jsx` — Renders forms with animations, validation, conditional logic and consent
  - `components/IntegrationsPanel.jsx` — Configure integrations per form
  - `components/AdminUI.jsx` — Shared page header, alert, empty/loading components, plus `LogoMark` / `LogoWordmark` (the brand mark and the "OpenFlow" wordmark used in the sidebar, topbar and login page; the same mark as `public/favicon.svg` and `docs/assets/openflow-mark.svg`)
  - `components/AnimatedBackground.jsx` — The form's animated backgrounds (CSS Waves/Aurora; canvas Gradient Wave, Gateway Flow, Flow). Legacy `bubbles`/`particles` values map to `gradientWave`/`gatewayFlow` via `normalizeBgAnimation`
  - `locales.js` — Built-in respondent-facing UI strings (EN / DE)
  - `autofill.js` — Browser-autofill (`autocomplete`) tokens per field + the editor's "Autofill tip" heuristic for Short Text fields
  - `clickIds.js` — Ad click-ID capture for FormView/EmbedView (gclid/gbraid/wbraid, `fbclid` → `fbc`, Meta Pixel `_fbp`/`_fbc` cookies), used only after cookie consent
- **API Client**: `api.js` — Wrapper for backend API calls
- **Dev Server**: Vite with proxy to backend (port 3000)

### WordPress Plugin
- **Location**: `wordpress-plugin/openflow/`
- **Features**: Shortcode `[openflow]`, WPBakery element, Gutenberg block
- **Key Files**: `openflow.php`, `block.js`, `readme.txt`
- **Versioning**: The plugin carries its **own** version (`OPENFLOW_VERSION` in `openflow.php` + the `Stable tag` in `readme.txt`), independent of the app version

### Infrastructure
- **Docker**: A single `app` service in `docker-compose.yml`. The multi-stage `Dockerfile` builds the frontend and copies `dist/` into the backend's `public/`, so one container serves both the API and the UI. `.github/workflows/docker-publish.yml` builds and pushes a multi-arch (`linux/amd64`/`linux/arm64`) image to `ghcr.io/vidual-labs/openflow` (tags: `latest` + the `backend/package.json` version) on every push to `main`, so `docker-compose.yml` can `image:` it directly — `docker compose pull && docker compose up -d` needs no local build; `--build` still works for source builds.
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
# Login: admin@openflow.local + the one-time password printed by
#   docker compose logs app
```
There is no default password anywhere: with `ADMIN_PASSWORD` unset, the first
boot generates a random one-time admin password and prints it to the log (the
old `admin123` compose fallback was removed in 0.16). A weak or well-known
`ADMIN_PASSWORD` (< 10 chars, `admin123`, `Password2026!`, …) makes the first
boot refuse to seed (`models/secureDefaults.js`). Two-factor login codes need
system e-mail: Settings → System e-mail, or `SMTP_HOST`/`SMTP_FROM` (+
`SMTP_REQUIRE_TLS=false` / encryption "None" for a local catcher such as Mailpit).

## Key Development Patterns

### Form Structure (Backend)
A form row in `forms` holds everything as JSON columns — there is no separate
fields table:
- **`steps`**: Array of steps, each with field type, label, placeholder, validation, etc. A step is normally one field; two adjacent questions can be merged into a `{ type: 'group', fields: [a, b] }` step. Use `utils/steps.js#flattenFields` before touching leaf fields. Every leaf field (incl. group sub-fields and address `customFields`) also carries a stable, human-readable **`key`** (`[a-z][a-z0-9_]{0,39}`, unique within the form — `utils/fieldKeys.js`): the editor derives it from the label until the operator edits it (`keyCustom`), the save path fills missing keys and refuses duplicates/malformed keys with 400, and a boot migration (`db.js#ensureFormFieldKeys`, also run after a restore) keyed every pre-0.46 form. Keys are what the outside world maps on (lodgely, the submission contract); submission `data` stays keyed by `id`.
- **`theme`**: Colors, fonts, animated backgrounds, button position, custom CSS, language
- **`end_screen`**: Thank-you content, auto-redirect, GDPR consent settings, cookie-banner settings
- **`gtm_id`**: GTM container id (validated as `GTM-XXXXXXX`, since it is interpolated into a raw `<script>` tag)
- **Integrations**: Rows in the `integrations` table, keyed by `form_id`
- **Landing Page**: Optional logo, headline, subline, footer links (in `theme`)
- **Conditional Logic**: Show/hide rules based on previous answers (stored in step config as `condition: { field: <key>, op, value }` — `field` is the referenced field's **key** since 0.46; a bare id still resolves via `fieldKeys.js#fieldIdResolver`)

### Form Field Types
15 types the builder can add (`FIELD_TYPES` in `frontend/src/pages/FormEditor.jsx`):
Short Text, Long Text, Number, Date, Date & Timeslot, Single Choice, Multiple Choice,
Yes/No, Rating, Image/Icon Select, File Upload, Email, Phone, Website URL, Address. Each
has validation, placeholder, help text, and conditional visibility.

**Date & Timeslot** is a two-stage picker (day, then a time on that day) meant for
booking-style forms. The day's times are shown in a column beside the month that scrolls
on its own (stacked under it in narrow frames), and the step auto-advances once both a day
and a time are picked. With nothing configured it generates times itself from the field's
own `windowStart`/`windowEnd`/`durationMin`/`rangeDays`, with no conflict checking — good
enough for a simple lead form. It can optionally be pointed at a self-hosted
[calon](https://github.com/vidual-labs/calon) instance (`step.calon.baseUrl` +
`resourceSlug`), in which case the times shown are calon's own real availability instead.
The backend proxies that read (`GET /api/public/form/:slug/availability`,
`backend/src/models/calon.js`) — the browser never talks to calon directly — through the
same `utils/ssrf.js#assertSafeUrl` guard as any other operator-supplied URL. On submit, the
picked slot is **booked** in calon before the submission is stored
(`models/calonBooking.js`, via calon's public `POST /api/v1/bookings` — no secret, no
calon-side config): a rejection returns `409 { code: 'slot_unavailable', fieldId }`
and the renderer sends the respondent back to that step; calon being unreachable
stores the submission with `metadata.calonBookings[fieldId].status = 'pending'` (plus
`metadata.calonPending`) and the delivery worker's sweep retries it. The requester's
name/email/phone come from `step.calon.nameFieldId`/`emailFieldId`/`phoneFieldId`, or
automatically from the first Email/Phone field and a name-autofill Short Text. The answer is
stored as one plain string, `"2026-09-02 09:30"` (or with a trailing IANA timezone when it
came from calon), for the same reason a date range is ("Add a New Field Type" below /
`FormRenderer.jsx`'s `DATE_RANGE_SEPARATOR` comment): every downstream consumer (CSV,
webhooks, the e-mail table, the lodgely connector) just works on plain text.

**Browser autofill**: the renderer puts an `autocomplete` + `name` on inputs whose
meaning is known (`autofill.js#autofillToken`): email, phone, website and the address
sub-inputs always, Short Text only when the operator set `step.autocomplete` (allowlisted
tokens; `''` = explicitly none, which also silences the editor's tip).

**Consent/GDPR is not a field type** — it's a form-level setting (**GTM / GDPR**
tab) that either appends a checkbox under the last question or adds a synthetic
final step (`CONSENT_STEP_ID` in `FormRenderer.jsx`). It arrives in the
submission as `_consent: true`. A `consent` *field* type is still rendered for
backwards compatibility with forms built before this moved.

### Integration Engine (`models/integrations.js`)
Handles all outbound data flows via `runIntegration()`'s switch on
`integration.type`:
- **`webhook`**: POST/PUT with optional HMAC-SHA256 signing in `X-OpenFlow-Signature`. The digest is computed over the exact serialized body bytes (`{event, formId, formTitle, data, timestamp: <ISO>}`), so a receiver verifies it by HMAC-ing the raw request body. Keep signing the exact bytes sent.
- **`email`**: SMTP with HTML-formatted submission table (values HTML-escaped)
- **`google_sheets`**: Both Sheets variants share this type and branch on `config.mode` — `apps_script` (URL only) or `service_account` (JSON key, auto-creates headers). The UI's `google_sheets_sa` option is mapped to `google_sheets` before saving.
- **`google_ads_conversion`**: Offline conversion upload via the Data Manager API; only runs for submissions carrying a `gclid`/`gbraid`/`wbraid`
- **`meta_conversion_api`**: Server-side `Lead` event to Meta's Conversions API (Graph API `/​{pixel_id}/events`), keyed by `pixel_id` + `access_token`. No Meta Pixel is required — `user_data` is built from the submission's captured IP/user agent, SHA-256-hashed `email`/`phone` field values (matched by field **type**, not id), and — when captured after cookie consent — `fbc` (built client-side from `?fbclid=`, `clickIds.js`) / `fbp` (Meta Pixel cookies), whitelisted by format in `POST /form/:slug/submit`. `event_id` is the submission id (the delivery queue passes it in as `metadata.submissionId`, not stored); the browser gets the same id as `eventId` on the `openflow_submit` dataLayer push and in the embed's `openflow-submit` postMessage, for Pixel deduplication. An optional `test_event_code` routes events to Events Manager's Test Events tool instead of counting them as real leads; the integration's "Test" button only sends a real event when one is set (otherwise it just validates `pixel_id`/`access_token` via a GET, like Google Ads validates OAuth)

**Secrets are write-only.** Fields listed in `SECRET_FIELDS`
(`models/integrationSecrets.js`) are never returned by the integrations API —
responses carry a `secrets: { field: { set, hint? } }` map instead, and an
update that omits a secret keeps the stored one (`null`/`''` clears it). A new
integration type with a credential must add it there, and use `SecretInput` in
`IntegrationsPanel.jsx`. SMTP hosts are checked for link-local/metadata
addresses (`SMTP_BLOCK_PRIVATE_HOSTS=true` for the full private-range check).

Each integration has an enabled flag and a test endpoint
(`POST /api/integrations/:formId/:id/test`). Google Ads is special-cased there:
its test only validates OAuth credentials via `testGoogleAdsCredentials()`
instead of uploading a fake conversion. Deliveries go through
`models/deliveryQueue.js`, which persists an `integration_deliveries` row per
attempt and retries with backoff before marking it dead.

### Analytics
Tracks per-form and global stats: views, starts, completions, conversion rates,
step drop-off. Data stored in the `analytics_events` table. Ranges are whole
UTC days (`from`/`to`, inclusive). Per-step numbers come from walking each
session's own ordered `step`/`complete` events (`stepStats` in
`routes/analytics.js`), keyed by step id: *reached* = saw the step, *dropped* =
the session's last step and no completion, *time on step* = until the next
step or the completion. There is no flow-version history: comparing two date
ranges is how an operator checks whether a flow change moved the drop-off.

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
rules, backup/restore, sessions/lockout/2FA/password change/security headers (`loginSecurity.test.js`), system-mail settings (`systemMailSettings.test.js`), calon availability/booking, analytics ranges and step drop-off, encryption, integration
secrets, Meta CAPI, the audit log, session revocation, stable field keys
(`fieldKeys.test.js`) and the security hardening (`securityHardening.test.js`).
There is no frontend test suite.

## Version Management

**Important**: Every commit must include a version bump.

Version files to update:
1. **CHANGELOG.md** — Add new entry with date and changes
2. **backend/package.json** + **backend/package-lock.json** — Update `version` (twice in the lockfile: the root and the `""` package entry)
3. **frontend/package.json** + **frontend/package-lock.json** — Same
4. **CLAUDE.md** — Update "Current Version" at the top of this file

Nothing else needs touching: the admin sidebar reads the version from
`frontend/package.json`, `GET /api/health` reads it from `backend/package.json`, and
the README's version badge is a shields.io badge over `backend/package.json`,
so none of them can go stale. The README header is the logo in `docs/assets/`
(light/dark SVGs swapped by a `<picture>` element) plus badges — it carries no
version text. The WordPress plugin is versioned separately.

**Version Format**: Semantic versioning (e.g., 0.7.4)
- Patch (0.7.4 → 0.7.5): Bug fixes
- Minor (0.7.0 → 0.8.0): New features
- Major (1.0.0): Breaking changes

## Database Schema

Defined in one `CREATE TABLE IF NOT EXISTS` block plus additive `ALTER TABLE`
migrations in `models/db.js`:

- `users` — Users (email, bcrypt `password_hash`, `role` = `admin` | `user`, `twofa_enabled`; `token_version` is legacy, unused since 0.44)
- `sessions` / `trusted_devices` / `auth_challenges` / `login_failures` — Login state (hashed tokens, epoch-ms timestamps, no FKs, not in backups; a restore signs out everyone but the restoring admin)
- `forms` — Everything about a form: `steps`, `end_screen`, `theme` (JSON text columns), `slug`, `gtm_id`, `published`. Steps are **not** a separate table.
- `submissions` — User responses (`data` + `metadata` JSON, keyed by field id)
- `integrations` — Integration configs per form (`type`, `enabled`, `config` JSON)
- `analytics_events` — Analytics events (view, start, step, complete; `drop` is accepted but never sent) with `session_id`, `step_index`, `step_id` — no IP, no answers
- `integration_deliveries` — One row per (submission, integration) delivery; `attempts` counts retries in place (status, `next_attempt_at`, `last_error`) backing retries and dead letters
- `api_tokens` — Read-only API tokens (SHA-256 `token_hash`, `token_prefix`, `last_used_at`)
- `slug_history` — Old slugs of renamed forms, so previously shared links keep resolving
- `site_settings` — Global key/value settings: `branding` (public via `GET /api/settings`) and `smtp` (encrypted system-mail settings, private — `GET /api/settings` only returns the public `ALLOWED_KEYS`)
- `audit_log` — Security events (actor, action, target, IP, details)

## API Structure

- **Public** (`/api/public/`): No auth required. Load form, submit response, track analytics.
- **Admin** (`/api/forms`, `/api/submissions`, `/api/auth`): session (server-side `token` cookie / Bearer) or a read-only `ofw_` API token (`router.use(authMiddleware)`). Every query is scoped to the **owning user** (`user_id = req.userId`) — admins included; there is no cross-user form visibility yet.
- **Integrations** (`/api/integrations`): Test, create, update, delete integrations; list and retry deliveries.
- **Analytics** (`/api/analytics`): Get funnel and trend data.
- **Settings** (`/api/settings`): `GET` is public (branding, `primaryHost` and the `landingPage` flag are needed by the logged-out screen and form editor); `PUT /:key` is admin-only and restricted to an allowlist of keys.
- **Admin-only** (`/api/admin/`): Backup, restore, and scheduled-backup listing. The whole router is behind `authMiddleware, requireAdmin`, and it is blocked outright on per-form subdomains. `requireAdmin` rejects API tokens, so a token never inherits its owner's admin rights.

### External consumer: lodgely (lead intake hub)

[lodgely](https://github.com/vidual-labs/lodgely) has a built-in OpenFlow
connector that **pulls** submissions out of an install — it is not a push
integration configured here, but it does depend on this API's shape:

- **Auth (preferred): an API token.** A logged-in user mints a read-only token
  under **Account → API Tokens** (`POST /api/auth/tokens`), and lodgely sends
  it as a `Bearer` token. See "API tokens" below.
- **Auth (fallback): login.** lodgely can still log in via `POST /api/auth/login`
  (email + password) and read the session token from the **`token` httpOnly
  cookie** (an opaque server-side session token since 0.44, no longer a JWT),
  then send it as a `Bearer` token. This does not work for an account with
  two-factor login on (the login answers `{ twoFactorRequired }` without a
  cookie) — such accounts must use an API token. **Don't rename the `token`
  cookie or stop accepting the Bearer header without coordinating.**
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
managed in the UI under **Account → API Tokens**.

## Common Tasks

### Add a New Field Type
1. Add an entry to `FIELD_TYPES` in `frontend/src/pages/FormEditor.jsx` (value, label, icon, smart defaults) plus any type-specific config UI
2. Add a renderer + client-side validation in `frontend/src/components/FormRenderer.jsx` (`FIELD_TYPES` map and `validateField`), and add it to `AUTO_ADVANCE_FIELDS` if it should advance on click
3. Add respondent-facing strings to `frontend/src/locales.js` for every language
4. If the server needs to enforce more than "required and non-empty", extend the validation loop in `backend/src/routes/public.js` (`POST /form/:slug/submit`)
5. Test in FormEditor, FormView and EmbedView

### Add a New Integration
1. Add a `case` to `runIntegration()` in `backend/src/models/integrations.js` and a `run<Name>()` that **throws** on failure, so the delivery queue can retry it
2. Add the type to `INTEGRATION_TYPES` and a config form in `frontend/src/components/IntegrationsPanel.jsx`
3. If the integration fetches a user-supplied URL, run it through `utils/ssrf.js#assertSafeUrl`; list any credential fields in `SECRET_FIELDS` (`models/integrationSecrets.js`)
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
- **Conditional Logic**: Stored as a `condition` on the step. Evaluated client-side during form render and mirrored on submit by `utils/conditions.js`, so the server skips validation of hidden steps and drops their stale answers.
- **Form Slugs**: Unique URL identifier for public form access (`/f/<slug>` and `/embed/<slug>`). Renaming a slug archives the old one in `slug_history` so old links still resolve.
- **Multi-User**: Admin can invite users and assign roles (`admin` / `user`). `requireAdmin` / `requireSession` live in `middleware/auth.js` (the one copy — don't re-implement role checks inline). Forms are private to their owner.
- **Reverse proxy**: set `TRUST_PROXY` (e.g. `1`) behind a proxy, or every visitor shares the proxy's IP — one rate-limit bucket and a wrong `metadata.ip`. `utils/trustProxy.js` logs `trust_proxy_not_configured` once when it sees `X-Forwarded-For` without it.
- **Secrets**: `ENCRYPTION_KEY` is auto-generated and persisted next to the DB when unset; there is no hardcoded fallback. `JWT_SECRET` is unused since 0.44 (sessions are server-side) and only logs a "you can remove it" note.
- **Login security**: Passwords are only ever compared with the async bcrypt API (`models/passwords.js`) — never `compareSync`, which would block the event loop for ~300 ms per login at cost 12. A new password must pass `isAcceptableNewPassword` (with the account's e-mail). Anything that should end a user's access calls `sessions.revokeUserSessions` (with `devices: true` when remembered browsers must re-verify).
- **Untrusted input into HTML**: GTM ids, custom CSS and emailed field values all pass through validation/sanitization (`validateGtmId`, `utils/sanitizeCss.js`, `escapeHtmlAttr`). Keep it that way when touching those paths.

## Conventions

- **Form IDs / submission IDs / user IDs**: UUID v4
- **Form slugs**: 8-char nanoid over `[a-z0-9]`, editable afterwards
- **Field IDs**: generated in the editor as `field_<timestamp>` (`group_…` for combined steps, `custom_…` for address sub-fields). They are opaque — never parse them. Submission `data` is keyed by id.
- **Field keys**: `[a-z][a-z0-9_]{0,39}`, unique per form, derived from the label (umlauts transliterated: Straße → `strasse`; Email/Phone/Website/Address fields default to the type name) with `_2`, `_3` on collision. Conditions reference keys. The derivation lives twice — `backend/src/utils/fieldKeys.js` and `frontend/src/utils/fieldKeys.js` — keep them identical.
- **Naming**: camelCase in JavaScript, snake_case in SQL/database
- **Colors**: Hex format (e.g., `#FF5733`)
- **Timestamps**: SQLite `datetime('now')` (UTC, `YYYY-MM-DD HH:MM:SS`) for row defaults; submission `metadata.submittedAt` is a full ISO 8601 string
