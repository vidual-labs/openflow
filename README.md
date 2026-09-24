# 🌊 OpenFlow v0.39.0
> Open-source form builder for lead generation. A self-hosted alternative to Typeform and Heyflow.

## 📚 Table of Contents

[Features](#-features) · [Quick Start](#-quick-start) · [Updating](#-updating) · [Configuration](#️-configuration) · [Architecture](#️-architecture) · [Field Types](#-field-types) · [Integrations](#-integrations) ([calon](#-calon-real-time-booking--calendar-sync)) · [Analytics](#-analytics) · [GTM Events](#️-gtm-events) ([Cookie Banner](#-cookie-consent-banner)) · [Embedding](#-embedding) ([iFrame](#simple-iframe) · [Auto-Resize](#iframe-with-auto-resize) · [WordPress](#wordpress) · [URL Slug](#custom-url-slug) · [Subdomains](#custom-subdomains)) · [API Endpoints](#-api-endpoints) · [Development](#‍-development) · [Security & Production Notes](#-security--production-notes) · [Roadmap](#️-roadmap) · [License](#-license)

## ✨ Features

### 🎯 Form Builder
- **Multi-Step Forms** — Typeform-style one-question-at-a-time experience with smooth animations
- **15 Field Types** — Short Text, Long Text, Number, Date, Date & Timeslot, Single Choice, Multiple Choice, Yes/No, Rating, Image/Icon Select, File Upload, Email, Phone, Website URL, Address
- **Built-in [calon](https://github.com/vidual-labs/calon) booking integration** — point a Date & Timeslot field at a self-hosted calon instance and it shows that calendar's real, conflict-checked availability **and** books the selected slot into a real calendar. When the calon resource is connected to a Google Calendar or Microsoft 365 calendar, accepted bookings are written straight into it. Entirely optional — nothing else about the form depends on it
- **Number Stepper** — Large +/− buttons with a configurable step size and an optional prefilled start value, for quantity questions where 0 or 1 is an unlikely answer
- **Inline Date Picker** — An always-visible calendar per date step, set to either a single day or a date range (from – to), with selectable-window limits and localized month/weekday names
- **Conditional Logic** — Show/hide steps based on previous answers (equals, contains, is set, etc.)
- **Combined Steps** — Merge two adjacent questions onto one screen (e.g. email + phone), optionally requiring just one of them to be answered; reorder the questions inside with ↑ / ↓
- **Flat-Rate Pricing Filter** — On a choice step, hide budget options that can't cover a rate × quantity answered earlier, so nobody picks an impossible budget
- **Smart Defaults** — Selecting a field type auto-fills question, label, and placeholder
- **Browser Autofill** — Email, Phone, Website and Address fields tell the browser what they hold, so saved details fill in with one tap; Short Text fields can be set to Full name, Company, City and more, and the editor suggests the right setting (or a better field type) when a question looks like one of these
- **Visual Editor** — Collapsible question cards, reorder, visual field type picker with icons
- **Emoji/Icon Picker** — Built-in category-based emoji selector for Image/Icon Select fields
- **Landing Page Mode** — Add logo, headline, and subline on top of the form
- **Footer Links** — Add up to 3 links (Privacy Policy, Imprint, Terms) below the form
- **End Screen** — Custom thank-you title and message with a light entrance animation, plus an optional redirect URL that can open automatically on submit (breaking out of the iframe when embedded)
- **Theme Customization** — Colors, custom CSS, animated backgrounds, and branding per form, with a live preview in the Design tab; buttons and the progress bar blend the primary into the accent color
- **Animated Backgrounds** — 5 presets in the form's primary and accent colors: Waves and Aurora (CSS), plus Gradient Wave, Gateway Flow and Flow (canvas, no extra dependencies). Visitors with "reduce motion" turned on see a still frame
- **Configurable Button Position** — Place the "Next" button in the footer bar or inline below the input field
- **Editable Button Labels** — Override the built-in "Next" / "Submit" wording per form
- **Form Language (EN / DE)** — Sets the language of every built-in string shown to respondents, including error messages and calendar month/weekday names
- **Enter Key Hint** — Optional "press Enter" keyboard shortcut hint next to the Next button
- **GDPR-Ready** — Consent under the last question or as its own final step, agreed to by a deliberate press of Enter or a click (form-level toggle)
- **File Uploads** — Drag & drop with configurable file types and size limits
- **Duplicate a Form** — One-click copy of a form's questions, theme and integrations, created as a draft with copied integrations disabled


<img width="1017" height="672" alt="grafik" src="https://github.com/user-attachments/assets/1265603a-4602-44e6-97b0-15c77afb9456" />
<img width="1502" height="1041" alt="grafik" src="https://github.com/user-attachments/assets/cc4e4a66-ee1b-4147-bd01-e5ae46230132" />


### 📊 Data & Integrations
- **Webhook Support** — POST/PUT submission data to any URL with optional HMAC signing
- **📧 Email Notifications** — SMTP-based alerts with beautiful HTML submission tables
- **📝 Google Sheets (Simple)** — Via Google Apps Script — no service account needed, just paste a URL
- **📝 Google Sheets (Service Account)** — Auto-append rows via service account for advanced setups
- **🎯 Google Ads (Server-Side Conversion)** — Upload leads with a captured `gclid`/`gbraid`/`wbraid` as offline conversions via Google's Data Manager API
- **📣 Meta Conversions API** — Send a server-side `Lead` event to Facebook/Instagram Ads on every submission, no Meta Pixel required; matches leads to ad clicks via `fbclid`, and deduplicates against a Meta Pixel via a shared event ID
- **CSV Export** — Download all submissions as CSV
- **Test Button** — Verify each integration with sample data before going live

### 📈 Analytics Dashboard
- **Conversion Funnel** — Views → Starts → Completions with conversion rates
- **Step Drop-off** — See where users abandon the form
- **Daily Trends** — Visual chart of form activity over time
- **Per-Form Stats** — Detailed analytics for each form

### 🔌 Embedding & Tracking
- **iframe Embed** — Drop forms into any landing page (with auto-resize)
- **Editable URL Slug** — Rename a form's URL anytime (`/f/spring-launch` instead of the auto-generated 8-char code); old links keep working, and the browser is rewritten to the current URL
- **Custom Subdomain** — Host each form on its own subdomain of a domain you control (e.g. `acme.forms.example.com`), backed by a single wildcard TLS cert
- **🏷️ GTM Integration** — Google Tag Manager per form, with step and submit events
- **🍪 Cookie Consent Banner** — Optional banner shown *before* GTM loads, so tracking only starts once the visitor accepts
- **WordPress Plugin** — Shortcode `[openflow]`, WPBakery element, and Gutenberg block

### 🛠️ Infrastructure
- **🐳 Docker** — One command to start, from an official pre-built multi-arch image (`ghcr.io/vidual-labs/openflow`) or from source
- **SQLite** — Zero-config database, no external DB needed
- **🛡️ Rate Limiting** — Built-in in-memory spam protection
- **👥 Multi-User** — Admin can invite users, assign roles (admin/user)
- **🏷️ White-Label Branding** — Admins can swap or hide the vendor logo in the admin sidebar (**Settings → Branding**)
- **🔑 API Tokens** — Read-only tokens for programmatic API access (e.g. the lodgely connector); created under Settings, hashed at rest, revocable anytime
- **💾 Backup & Restore** — Admins can download a full JSON snapshot of the database and restore it later; older backups are auto-migrated to the current format on restore
- **⏰ Scheduled Backups** — A background job writes a rotating backup on an interval to a separate volume, so recovery doesn't depend on someone remembering to click "Download"
- **🔁 Retrying Integration Deliveries** — Failed webhook/email/Sheets deliveries retry with backoff instead of silently dropping the lead; exhausted retries surface as a dead letter you can manually retry from the Integrations tab
- **📋 Audit Log** — Logins (success/failure), user/role changes, settings changes, and backup/restore are recorded with actor, IP and timestamp for post-incident review (`GET /api/admin/audit-log`, admin only)
- **🔒 Session Revocation** — Changing a user's password or role, or clicking **Log out everywhere** on the Users page, immediately invalidates that user's existing login sessions instead of letting a stale JWT keep working for up to 7 more days
- **🔐 Encrypted, Write-Only Integration Secrets** — SMTP passwords, Google service-account keys, OAuth client secrets/refresh tokens, Meta access tokens and webhook HMAC secrets are encrypted (AES-256-GCM) before being stored, so a leaked database file or backup JSON doesn't hand over live credentials. The API never returns them once saved — the editor only shows that one is set, and lets you replace or remove it
- **❤️ Health Check** — `GET /api/health` reports database connectivity and uptime for uptime monitors and container orchestrators
- **📊 Structured Logging** — Request, integration-delivery, and backup events are logged as single-line JSON so they can be piped into any log aggregator
- **🌙 Dark Mode** — Auto/light/dark theme toggle for the admin interface
- **🛡️ Delete Protection** — Published forms require typing the form name to confirm deletion
- **♿ Accessible Forms** — Labeled questions, announced errors, keyboard-operable file uploads, and a progress bar and choice controls exposed to assistive tech (WCAG 2.1 AA pass on `/f/:slug` and `/embed/:slug`)
- **Responsive** — Optimized for mobile and desktop

---

## 🚀 Quick Start

```bash
git clone https://github.com/vidual-labs/openflow.git
cd openflow
docker compose pull
docker compose up -d
```

This pulls the official pre-built image from `ghcr.io/vidual-labs/openflow`
(multi-arch: `linux/amd64` + `linux/arm64`) — no local build required.

Building from source instead (e.g. if you're contributing, or changed the
`Dockerfile`):

```bash
docker compose up -d --build
```

The app runs on `http://localhost:3000`.

**🔑 First Login:**
- Email: `admin@openflow.local` (or your `ADMIN_EMAIL`)
- Password: OpenFlow never ships a hardcoded default. If `ADMIN_PASSWORD` isn't set, a random one-time password is generated on first start and printed **once** to the container log (`docker compose logs app`) — copy it from there to log in, then change it. Set `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env` before the first start to control both explicitly instead.

---

## 🔄 Updating

To update an existing Docker installation:

```bash
cd openflow
git pull
docker compose pull
docker compose up -d
```

(Building from source instead: `git pull && docker compose up -d --build`.)

Your data is safe — the SQLite database is stored in a Docker volume (`db-data`) and persists across rebuilds.

> 💡 To fully recreate the container (e.g. after major changes): `docker compose down && docker compose up -d --build`
> ⚠️ To reset everything including data: `docker compose down -v && docker compose up -d --build`

---

## ⚙️ Configuration

Environment variables (in `.env` or docker-compose):

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *(none — auto-generated)* | 🔐 JWT signing key. If unset, a random secret is generated and persisted next to the database — set this explicitly in production so sessions survive a volume reset |
| `ENCRYPTION_KEY` | *(none — auto-generated)* | 🔐 64 hex chars (32 bytes). Encrypts integration secrets (SMTP passwords, Google credentials, webhook HMAC secrets) at rest. If unset, a random key is generated and persisted next to the database — set this explicitly in production **and back it up separately from the database**, since losing it makes existing encrypted integration config unrecoverable. Setting it on an install that ran on an auto-generated key is safe: the old key file is still used to read existing secrets. Backups contain secrets encrypted with this key, so restoring on another instance needs the same key |
| `SMTP_BLOCK_PRIVATE_HOSTS` | *(unset)* | 📧 SMTP hosts resolving to link-local/cloud-metadata addresses are always refused. Set to `true` to also refuse private networks and localhost (as webhooks do) when you don't relay mail through an internal server |
| `ADMIN_EMAIL` | `admin@openflow.local` | 👤 Admin email |
| `ADMIN_PASSWORD` | *(none — auto-generated)* | 🔑 Admin password (only on first start). If unset, a random one is generated and printed to the log once |
| `DB_PATH` | `/app/data/openflow.db` | 💾 SQLite database path |
| `PORT` | `3000` | 🌐 Port the app listens on *inside* the container |
| `HOST_PORT` | `3000` | 🌐 Host-side port `docker-compose.yml` publishes (set this instead of editing `docker-compose.yml` directly, so `git pull` never conflicts with a local port change) |
| `CORS_ORIGINS` | *(empty)* | 🌍 Comma-separated extra origins allowed to call the API. Same-origin requests are always allowed, so this is only needed when the admin UI is served from a different host than the API |
| `OPENFLOW_PRIMARY_HOST` | *(empty)* | 🌐 Apex host for [custom subdomains](#custom-subdomains). Also implicitly allowed as a CORS origin |
| `OPENFLOW_VERSION` | `latest` | 🐳 Image tag `docker-compose.yml` pulls (e.g. `0.31.0` to pin a version instead of always tracking `latest`) |
| `BACKUP_ENABLED` | `true` | ⏰ Set to `false` to disable the scheduled backup job |
| `BACKUP_DIR` | `/app/backups` (from `docker-compose.yml`; otherwise a `backups/` folder next to `DB_PATH`) | 📁 Where scheduled backups are written (point at a separate volume for real off-box protection) |
| `BACKUP_INTERVAL_HOURS` | `24` | ⏱️ How often to write a scheduled backup |
| `BACKUP_RETENTION_COUNT` | `14` | 🗑️ How many scheduled backups to keep before pruning the oldest |

> 💾 `docker-compose.yml` bind-mounts `./backups` on the host into the container, deliberately **outside** the `db-data` volume — so wiping or losing that volume doesn't take the backups with it. Copy `./backups` off the host regularly for real disaster recovery.

---

## 🏗️ Architecture

```
openflow/
├── backend/                        # 🟢 Express API + SQLite (also serves the built frontend)
│   ├── src/
│   │   ├── index.js                # Server entry point, CORS, SPA fallback
│   │   ├── models/                 # DB schema, integrations engine, delivery queue,
│   │   │                           #   backups, API tokens, rate limiting
│   │   ├── middleware/             # JWT + API-token auth, per-form subdomain routing
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

---

## 📋 Field Types

**Question Types:**

| Type | Description | Auto-advance |
|------|-------------|:---:|
| 📝 Short Text | Single-line text input | |
| 📄 Long Text | Multi-line text | |
| 🔢 Number | Numeric input with min/max | |
| 📅 Date | Date picker | |
| 📆 Date & Timeslot | Pick a day, then a time on that day; the day's times sit in a scrolling column beside the month (below it on phones). Generates its own times, or shows real availability from and books directly into a connected [calon](https://github.com/vidual-labs/calon) instance — including straight into a Google or Microsoft 365 calendar the calon resource is linked to | ✓ (once day and time are picked) |
| ☑️ Single Choice | Choose one option | ✓ |
| ✅ Multiple Choice | Choose multiple options, optionally with an "Other" free-text field | ✓ (not with "Other") |
| 👍 Yes / No | Binary choice | ✓ |
| ⭐ Rating | Star rating (configurable 3-10) | ✓ |
| 🖼️ Image / Icon Select | Visual grid with emoji picker or image URLs (1:1 recommended) | ✓ |
| 📎 File Upload | Drag & drop with configurable types and size limit | |

**Contact & Data Fields:**

| Type | Description | Sub-fields |
|------|-------------|------------|
| 📧 Email Address | Email with validation | |
| 📞 Phone Number | Phone number input | |
| 🌐 Website URL | URL with validation | |
| 🏠 Address | Composite address field (sub-field labels are editable) | Street, Postal Code, City, Country |

> 🔒 **Consent / GDPR is not a field type** — it's a per-form setting in the **GTM / GDPR** tab. Switch it on and the consent checkbox with your legal text is added either under the last question or as its own final step; it arrives in the submission as `_consent`.

Any two adjacent questions can be **combined** into a single step (e.g. email + phone side by side) via the **Combine** buttons in the editor, reordered inside the step with ↑ / ↓, and split apart again at any time.

Auto-advance can be switched off per form in the **Design** tab. Going back to an answered step never jumps forward again on its own, so the answer can be changed.

---

## 🔗 Integrations

Configure integrations per form in the **Integrations** tab of the form editor.

### 🔗 Webhook
Send submission data to any URL on each submission.
- Configurable HTTP method (POST/PUT)
- JSON payload: `event` (always `"submission"`), `formId`, `formTitle`, `data` (keyed by field id), `timestamp` (ISO 8601)
- Optional HMAC-SHA256 signing with a shared secret, sent as an `X-OpenFlow-Signature` header — the signature is computed over the exact JSON bytes sent as the body, so a receiver can verify it by HMAC-ing the raw request body it received
- The target URL is checked against private/internal address ranges before the request is made, and redirects are not followed

### 📧 Email Notification
Receive an email with a formatted HTML table of each submission.
- Full SMTP configuration (host, port, user, password, TLS)
- Customizable sender, recipient, and subject line

### 📊 Google Sheets (Simple)
Auto-append submissions via Google Apps Script — **no JSON key needed**.
1. Open your Google Sheet → Extensions → Apps Script
2. Paste the provided script, deploy as Web App
3. Copy the URL into OpenFlow

### 📊 Google Sheets (Service Account)
Auto-append each submission using a Google Service Account.
- Auto-creates header row from form field labels
- Configurable sheet name

### 🎯 Google Ads (Server-Side Conversion)
Upload qualifying leads as offline conversions directly to Google Ads, via the
[Data Manager API](https://developers.google.com/data-manager/api) — no
browser-side conversion pixel required.
- OpenFlow captures `gclid`/`gbraid`/`wbraid` from the form's landing URL
  (subject to the same cookie-consent setting used for GTM); submissions
  without one of these click IDs are skipped, since there's nothing to
  attribute them to
- Requires a one-time setup outside OpenFlow: an OAuth client + refresh token
  for a Google account with access to your Google Ads account (client ID,
  client secret, refresh token, customer ID, conversion action ID — pasted
  into the integration config, same as the Google Sheets service-account flow)
- No developer token needed — the Data Manager API uses plain OAuth2
- Optionally map one of the form's fields as the conversion value, or set a
  fixed default value
- The **Test** button only validates the OAuth credentials — it does not
  upload a real conversion, since a test submission has no genuine click ID
- See [`docs/integrations/google-ads.md`](docs/integrations/google-ads.md) for the full one-time setup walkthrough

### 📣 Meta Conversions API
Send a server-side `Lead` event to Facebook/Instagram Ads on every
submission, via [Meta's Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api) —
no Meta Pixel needs to be installed on the form.
- Matching relies on the submission's captured IP address and user agent,
  plus SHA-256-hashed `Email`/`Phone` field values when the form collects
  them (matched by field **type**, not id), and — once cookie consent allows
  it — the ad click ID (`?fbclid=` → `fbc`) and any Meta Pixel `_fbp`/`_fbc`
  cookies
- Every event carries the submission id as `event_id`; the same id is
  pushed to the dataLayer (`openflow_submit` → `eventId`) and posted to the
  embedding page, so a Meta Pixel `Lead` using it as `eventID` is
  deduplicated against the server-side event
- Click IDs are captured on the form's direct link (`/f/<slug>` or its
  subdomain). An embedded form can't read the host page's URL, so an
  `fbclid` there doesn't reach OpenFlow (the same applies to `gclid`)
- Requires a Pixel ID and an access token, both generated in Events Manager
  → Data Sources → your Pixel → Settings → Conversions API
- Optionally map one of the form's fields as the event value, or set a
  fixed default value
- An optional **Test Event Code** routes events into Events Manager's Test
  Events tool instead of counting them as real leads; the **Test** button
  only sends a real event while one is set — otherwise it just validates
  the Pixel ID/access token, since a test submission has no genuine lead
- See [`docs/integrations/meta-conversion-api.md`](docs/integrations/meta-conversion-api.md) for the full setup walkthrough

> 💡 Each integration has an **Enable/Disable** toggle and a **Test** button to verify your setup with sample data.

### 🏨 lodgely (lead intake hub)

[lodgely](https://github.com/vidual-labs/lodgely) — a self-hosted lead intake
hub — can **pull** a form's submissions into a specific client view. Unlike the
push integrations above, this is configured entirely in lodgely (under
**Imports → OpenFlow**), so there is nothing to set up on the OpenFlow side
beyond an admin account:

- **Recommended:** create a **read-only API token** under **Settings → API
  Tokens** and paste it into lodgely. The token can only read forms and
  submissions, never modify anything, and you can revoke it anytime without
  touching your password.
- Alternatively, lodgely can sign in with an OpenFlow login (email + password).
- It maps each OpenFlow field to a lead field; unmapped answers are kept as
  custom answers. Re-fetches are idempotent on the submission id.
- Point lodgely at your OpenFlow base URL and pick the form — leads flow into
  the chosen client automatically.

### 📅 calon (real-time booking + calendar sync)

[calon](https://github.com/vidual-labs/calon) — a self-hosted, single-container
booking engine — is wired into OpenFlow **directly**: a Date & Timeslot field is
pointed at a calon instance and talks to it through OpenFlow's own backend. No
webhook, no shared secret and no config on the calon side are needed — just the
calon URL in the field.

> **Requirements — read this first.**
>
> - **Two separate deployments.** calon is its own application and must be
>   deployed separately, at a URL **OpenFlow's server can reach**.
> - **The calendar write is done by calon, never by OpenFlow.** OpenFlow only
>   sends the chosen slot to calon. calon reads the connected calendar's
>   free/busy and **writes accepted bookings into Google Calendar or Microsoft
>   365**. OpenFlow holds no calendar credentials and never calls Google or
>   Microsoft.

Once connected (field editor → **Connect to calon**), OpenFlow:

- **Shows real availability** — the field renders the slots calon reports as free
  for that calendar (calon's scheduling rules and any connected calendar's busy
  time decide which). **Test connection** checks the link before you publish.
- **Books the picked slot on submit** — before the submission is stored, OpenFlow
  books the slot in calon under the respondent's name, email and phone. Which
  fields those are is picked under **Book under** in the same panel (automatic by
  default: the first Email and Phone fields, and a Short Text field with the
  *Full name* autofill). calon needs an email, so the form needs an Email field.
- **Sends the respondent back if the slot is gone** — when calon turns the slot
  down (taken in the meantime, or against its rules), the respondent lands back on
  the Date & Timeslot step with fresh times and a note to pick another; nothing is
  stored until the booking succeeds.
- **Never loses a lead to a calon outage** — if calon can't be reached at submit,
  the submission is stored anyway and the booking is retried in the background
  (1, 5, 30, 120, 360 minutes). The outcome is kept in the submission's metadata
  (`calonBookings`: `booked` with calon's booking id, `pending`, `rejected` or
  `failed`).

#### How the two sides talk

| Direction | Mechanism | What it does |
|-----------|-----------|--------------|
| OpenFlow → calon (availability) | `GET /api/v1/availability`, fetched **server-side** by OpenFlow | Returns which slots are free for the field's resource in the window; OpenFlow hands the list to its own frontend. Public and unauthenticated by design. |
| OpenFlow → calon (booking) | `POST /api/v1/bookings`, sent **server-side** by OpenFlow on submit | calon's public booking endpoint — the same one its own booking form uses. calon judges the request (conflicts, buffers, blackouts, connected calendar) and answers `201` (booked) or `200` with the reason it was rejected. |

Both calls go through the same SSRF guard as every other operator-supplied URL, and
neither needs CORS: OpenFlow's backend is the caller, never the browser.

#### Calendar sync (Google & Microsoft 365)

The calendar write is **calon's job**. To land bookings in a real calendar, connect the
calon resource's calendar in **calon's dashboard** (Calendars → Connect) — see the
["Resource calendar sync" section of calon's self-hosting
guide](https://github.com/vidual-labs/calon/blob/main/docs/self-hosting.md). calon then
hides slots that are busy on that calendar and writes each accepted booking into it.
Without a connected calendar, bookings still land in calon (its dashboard, `.ics` and
calendar links).

## 📈 Analytics

OpenFlow tracks form analytics automatically:

| Metric | Description |
|--------|-------------|
| **Views** | Unique sessions that loaded the form |
| **Starts** | Sessions that began filling the form |
| **Completions** | Sessions that submitted the form |
| **Conversion Rate** | Completions / Views (%) |
| **Step Drop-off** | Per-step session count to identify where users leave |

Access analytics from the **Analytics** page in the admin panel.

---

## 🏷️ GTM Events

OpenFlow automatically pushes events to the Google Tag Manager dataLayer:

| Event | Trigger | Data |
|-------|---------|------|
| `openflow_step` | Each step change | `formId`, `stepIndex`, `stepId` |
| `openflow_submit` | Form submitted | `formId`, `formTitle`, `eventId` (the submission id, for Meta Pixel deduplication) |

Set the container ID per form under **GTM / GDPR → GTM Container ID** (it must look like `GTM-XXXXXXX`).

### 🍪 Cookie consent banner

Optionally, a consent banner can be shown **before** the GTM container is loaded — GTM only fires once the visitor accepts, and the choice is remembered in their browser so the banner doesn't reappear. Enable it under **GTM / GDPR → Cookie / Tracking Consent Banner**; the message and both button labels are editable. A GTM container ID must be set first.

The same consent gates the ad click IDs that the [Google Ads](#-google-ads-server-side-conversion) (`gclid`/`gbraid`/`wbraid`) and [Meta Conversions API](#-meta-conversions-api) (`fbclid`, `_fbp`/`_fbc` cookies) integrations rely on.

---

## 🔌 Embedding

### Simple iFrame

```html
<iframe
  src="https://your-domain.com/embed/FORM_SLUG"
  width="100%" height="600"
  frameborder="0"
  style="border:none;border-radius:12px;">
</iframe>
```

### iFrame with Auto-Resize

```html
<iframe
  id="openflow-form"
  src="https://your-domain.com/embed/FORM_SLUG"
  width="100%" height="600"
  frameborder="0"
  style="border:none;border-radius:12px;">
</iframe>
<script>
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'openflow-resize') {
    document.getElementById('openflow-form').style.height = e.data.height + 'px';
  }
});
</script>
```

After a successful submission the iframe also posts
`{ type: 'openflow-submit', formId, eventId }` to the page, e.g. to fire a
Meta Pixel `Lead` with `eventID: e.data.eventId` (see
[`docs/integrations/meta-conversion-api.md`](docs/integrations/meta-conversion-api.md)).

### WordPress

1. Upload `wordpress-plugin/openflow/` to `/wp-content/plugins/`
2. Activate the plugin
3. Go to **Settings → OpenFlow** and enter your server URL
4. Use anywhere:

```
[openflow slug="your-form-slug" height="600" autoresize="true"]
```

Also available as a **WPBakery element** and **Gutenberg block**.

### Custom URL Slug

Every form is reachable at `/f/<slug>`. Open the form's **Embed** tab to rename the slug from the auto-generated 8-character code to anything memorable (e.g. `/f/spring-launch`). Rules:

- Lowercase letters, digits, hyphens. 3–60 characters.
- No leading/trailing or consecutive hyphens.
- Reserved labels (`admin`, `api`, `login`, `embed`, `f`, `dashboard`, …) are rejected.
- Must be unique across all forms.

Previously shared URLs keep working: when you change a slug, the old one is recorded in a history table and visits to it transparently load the form at its current slug. The browser URL bar is updated to the canonical address so subsequent shares use the new URL.

### Custom Subdomains

Serve each form on its own subdomain of a host you control (e.g. `acme.forms.example.com`). Every form gets a vanity URL that's friendlier than `/f/<slug>` and looks tenant-owned. A form keeps its existing `/f/<slug>` and `/embed/<slug>` paths in parallel — the subdomain is just an additional, prettier entry point.

#### How it works

Caddy fronts the app on ports 80/443 and acquires **one wildcard TLS certificate** for `*.<primary-host>` via Let's Encrypt's DNS-01 challenge. That single cert covers every form on every subdomain — there is no per-tenant verification step or on-demand TLS dance. When a request lands on `<sub>.<primary-host>`, the backend looks up which form claimed that subdomain, blocks any admin API paths with a 404, and injects the form's identity into `index.html`. The frontend then boots in form-only mode: every URL renders that form and admin routes are unreachable.

#### 1. Operator setup (one-time)

Pick an apex host you control (e.g. `forms.example.com`) and a DNS provider with a Caddy plugin (Cloudflare, Route53, DigitalOcean, Hetzner, Gandi, …).

**a. Configure DNS.** At your registrar, add a wildcard A/AAAA record:

```
*.forms.example.com   A   <your-server-ip>
forms.example.com     A   <your-server-ip>
```

Wait for propagation — `dig +short '*.forms.example.com'` (or any subdomain you pick) should resolve to your server. Cloudflare proxy (orange-cloud) must be **disabled** for the wildcard, otherwise Caddy can't see the real Host header.

**b. Create a scoped DNS API token.** The token only needs **edit** rights for that one zone — it's used by Caddy to add a temporary `_acme-challenge` TXT record during cert issuance.

**c. Fill in `.env`:**

```bash
OPENFLOW_PRIMARY_HOST=forms.example.com
CADDY_DNS_PROVIDER=cloudflare        # or route53, digitalocean, hetzner, ...
CADDY_DNS_TOKEN=your-scoped-api-token
CADDY_ACME_EMAIL=you@example.com     # optional, used by Let's Encrypt for expiry warnings

# Caddy image with the matching DNS plugin built in. The default caddy:2-alpine
# does NOT ship plugins — either use a community image or build your own.
CADDY_IMAGE=slothcroissant/caddy-cloudflaredns:latest
```

**d. Bring it up with the subdomain-aware overlay:**

```bash
docker compose -f docker-compose.yml -f docker-compose.subdomains.yml up -d --build
```

The overlay removes the public `3000:3000` binding (Caddy is the only ingress now) and adds the Caddy service that owns ports 80/443.

**e. Verify.** Tail Caddy until you see `certificate obtained successfully` for `*.<primary-host>`:

```bash
docker compose logs -f caddy
```

Then hit the apex in a browser → admin UI should load with a valid TLS cert.

> **DNS providers without a Caddy plugin** — your options are (a) build a Caddy image with `xcaddy` that includes a plugin for your provider, (b) put any other reverse proxy in front and skip the overlay, or (c) terminate TLS at a CDN (e.g. Cloudflare proxied DNS with a uploaded origin cert) and bypass the cert-issuance flow entirely.

#### 2. Per-form usage

For each form you want on its own subdomain:

1. Open the form in the editor and go to the **Embed** tab.
2. In **Custom subdomain (optional)**, type a label — `acme`, `widgets-inc`, `summer-promo` — and click **Update**.
   - Rules: 3–60 chars, lowercase letters, digits and hyphens only. No leading/trailing or consecutive hyphens. Common reserved labels (`www`, `api`, `admin`, `mail`, etc.) are rejected.
3. **Publish** the form (it must be live to be served on the subdomain).
4. The success message links to the live URL: `https://<label>.<your-primary-host>`.

To change the subdomain later, just edit the field and click **Update** — the form is reachable at the new label immediately. To detach the subdomain entirely, clear the field and click **Update** (or use the **Remove** button when the value matches what's saved). Note that — unlike the editable slug — subdomain changes are **not** archived: the old subdomain stops working immediately. Use it for stable tenant-style URLs, not for marketing campaign renames.

A form's `/f/<slug>` and `/embed/<slug>` URLs on the primary host always keep working in parallel.

#### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Caddy logs show `no DNS module registered with name "cloudflare"` (or similar) | The Caddy image doesn't include the DNS plugin. Use a community image or build with `xcaddy`. |
| Cert issuance hangs or times out | DNS API token lacks edit rights for the zone, or the wildcard record isn't visible yet. Verify with `dig`. |
| `acme: error: 429 :: urn:ietf:params:acme:error:rateLimited` | You hit Let's Encrypt's rate limit during testing. Caddy's data volume persists certs across restarts — don't `docker compose down -v` between attempts. |
| Subdomain returns the admin UI instead of the form | The form isn't published, or its `subdomain` field doesn't match the label. Confirm via `GET /api/forms/:id` on the admin host. |
| Visiting the subdomain shows "Form not found" | The subdomain is unclaimed, or the form was deleted/unpublished. |
| Admin works on `https://forms.example.com` but `https://forms.example.com:3000` is also reachable | You didn't use the overlay file — the base compose still publishes port 3000. Use both `-f` flags in `docker compose up`. |

---

## 📡 API Endpoints

### Public (no auth)
- `GET /api/health` — Liveness/readiness check (database connectivity + uptime), for orchestrators and uptime monitors
- `GET /api/public/form/:slug` — Load published form
- `POST /api/public/form/:slug/submit` — Submit response
- `POST /api/public/track` — Track analytics event

### Auth
- `POST /api/auth/login` — Log in (sets a `token` httpOnly cookie and returns the JWT)
- `POST /api/auth/logout` — Clear the session cookie
- `GET /api/auth/me` — Current user

### Admin (auth required)
- `GET /api/forms` — List all forms
- `GET /api/forms/:id` — Get one form (including its `steps`)
- `POST /api/forms` — Create form
- `POST /api/forms/:id/clone` — Duplicate a form (draft copy, integrations disabled)
- `PUT /api/forms/:id` — Update form
- `DELETE /api/forms/:id` — Delete form
- `GET /api/submissions/:formId` — Get submissions (paginated, newest first)
- `GET /api/submissions/:formId/export` — CSV export
- `DELETE /api/submissions/:formId/:submissionId` — Delete a submission
- `GET /api/settings` — Read global settings (public) — branding and the configured primary host
- `PUT /api/settings/:key` — Update a global setting (admin only)

### Integrations (auth required)
- `GET /api/integrations/:formId` — List integrations (secret fields are never returned; `secrets` says which are set)
- `POST /api/integrations/:formId` — Create integration
- `PUT /api/integrations/:formId/:id` — Update integration (an omitted secret field keeps its stored value, `null`/`""` clears it)
- `DELETE /api/integrations/:formId/:id` — Delete integration
- `POST /api/integrations/:formId/:id/test` — Test integration
- `GET /api/integrations/:formId/deliveries` — List delivery attempts (retrying/failed/dead)
- `POST /api/integrations/:formId/deliveries/:deliveryId/retry` — Manually retry a delivery

### Analytics (auth required)
- `GET /api/analytics/overview` — Overview stats for all forms
- `GET /api/analytics/:formId` — Detailed analytics for a form

### User Management (admin only)
- `GET /api/auth/users` — List all users
- `POST /api/auth/users` — Create/invite user
- `PUT /api/auth/users/:id` — Update user role/password (either one immediately revokes that user's existing sessions)
- `DELETE /api/auth/users/:id` — Delete user
- `POST /api/auth/users/:id/revoke-sessions` — Force-expire a user's existing sessions without changing their password ("Log out everywhere")

### API Tokens (session auth only — a token can never manage tokens)
- `GET /api/auth/tokens` — List your tokens (prefix + last used, never the secret)
- `POST /api/auth/tokens` — Mint a token (the plaintext `ofw_…` value is returned **once**)
- `DELETE /api/auth/tokens/:id` — Revoke a token

### Backup & Restore (admin only)
- `GET /api/admin/backup/info` — Summary of current DB contents and backup format version
- `GET /api/admin/backup` — Download a full JSON backup
- `POST /api/admin/restore` — Restore from a JSON backup
- `GET /api/admin/backups` — List backups written by the scheduler
- `GET /api/admin/backups/:filename` — Download a specific scheduled backup

### Audit Log (admin only)
- `GET /api/admin/audit-log?limit=200` — Recent security-relevant events (logins, user/role changes, settings changes, backup/restore), newest first. Not included in backups — it's a trail of what happened to the instance, not instance data to restore.

> 🔑 Read-only API tokens (`Authorization: Bearer ofw_…`) may call any **GET/HEAD** endpoint above on behalf of their owner. Every other method is rejected.

---

## 🧑‍💻 Development

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

---

## 🔒 Security & Production Notes

### TLS

The base `docker-compose.yml` serves plain HTTP on `:3000` — it does not
terminate TLS itself. Put a reverse proxy in front in production:
- Use the bundled [Custom Subdomains](#custom-subdomains) Caddy overlay
  (`docker-compose.subdomains.yml`) if you want per-form subdomains, which
  gets you TLS for free.
- Otherwise, put OpenFlow behind any reverse proxy you already run (Caddy,
  Nginx, Traefik, a managed load balancer) and terminate TLS there. This is
  a deliberate deployment-layer decision, not something the app does for
  you — most self-hosters already have a reverse proxy in front of every
  service on their box.

### Single-instance architecture

OpenFlow's rate limiter (`models/rateLimit.js`) and scheduled-backup job
(`models/backupScheduler.js`) are in-process and in-memory by design — this
keeps the app a genuinely zero-dependency, single SQLite file deployment
with nothing else to run (no Redis, no external queue). This is an accepted
tradeoff, not a bug: run **one** container per OpenFlow instance. Running
multiple replicas behind a load balancer will not share rate-limit state
between them (each replica enforces its own limits independently) and will
write duplicate scheduled backups. Horizontal scaling would need a shared
store for both and is not currently supported.

### Backups: what's automatic vs. manual

- **Automatic today**: a background job (`BACKUP_ENABLED`, on by default)
  writes a full JSON snapshot to `./backups` on an interval
  (`BACKUP_INTERVAL_HOURS`) and prunes old ones (`BACKUP_RETENTION_COUNT`).
  Admins can also trigger an on-demand download anytime from **Backup** in
  the admin UI, or `GET /api/admin/backup`.
- **Not automatic**: OpenFlow does not upload backups to S3/cloud storage
  for you. `./backups` is a host-local bind mount — copy it off-box on a
  schedule that matches your recovery requirements (`rsync`, a cron job, or
  your cloud provider's own volume backup tooling all work fine against a
  plain directory of JSON files).

### Deferred for now

The following are known gaps, deliberately not addressed yet:
- **Two-factor authentication (2FA)** — password + session-revocation only.
- **Admin UI localization** — only respondent-facing form strings ship in
  EN/DE (`frontend/src/locales.js`); the admin interface itself is
  English-only.
- **Automated data-retention / GDPR erasure workflows** — submissions can be
  deleted one at a time or exported as CSV, but there's no policy-driven
  auto-expiry or bulk "erase everything for this data subject" tool yet.

---

## 🗺️ Roadmap

- ✅ **Phase 1**: Multi-step forms, field types, Admin UI, GTM, iframe embed, CSV export, WordPress plugin
- ✅ **Phase 2**: Webhook, email notifications, Google Sheets integration
- ✅ **Phase 3**: Conditional logic, file uploads, custom CSS per form, multi-user support, landing page header/footer
- ✅ **Phase 4**: Analytics dashboard, simplified Google Sheets, dark mode, delete protection for live forms
- ✅ **Phase 5**: Editable slugs and per-form subdomains, backup & restore, read-only API tokens, retrying integration deliveries, server-side Google Ads conversions, Meta Conversions API, Date & Timeslot with calon booking, browser autofill, published Docker image
- 🔜 **Phase 6**: A/B testing, form templates, more languages

--

## Ethical use

OpenFlow is a marketing tool. We ask, as a non-binding ethical request, that you do not use it for clients in:

    Weapons and armaments
    Fossil-fuel energy (extraction, refining, distribution, generation)
    Internal-combustion / fossil-fuel passenger vehicles — electric vehicles, bicycles and public transit are explicitly fine.

This is a request from the maintainers, not a legal restriction (lodgely remains GPL-3.0). See the preamble in LICENSE for the full statement.


---

## 📄 License

GPL 3.0 — see [LICENSE](LICENSE).

---

