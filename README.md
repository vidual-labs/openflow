# 🌊 OpenFlow v0.17.0
> Open-source form builder for lead generation. A self-hosted alternative to Typeform and Heyflow.

## 📚 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [🔄 Updating](#-updating)
- [⚙️ Configuration](#️-configuration)
- [🏗️ Architecture](#️-architecture)
- [📋 Field Types](#-field-types)
- [🔗 Integrations](#-integrations)
- [📈 Analytics](#-analytics)
- [🏷️ GTM Events](#️-gtm-events)
- [🔌 Embedding](#-embedding)
  - [Simple iFrame](#simple-iframe)
  - [iFrame with Auto-Resize](#iframe-with-auto-resize)
  - [WordPress](#wordpress)
  - [Custom URL Slug](#custom-url-slug)
  - [Custom Subdomains](#custom-subdomains)
- [📡 API Endpoints](#-api-endpoints)
- [🧑‍💻 Development](#‍-development)
- [🗺️ Roadmap](#️-roadmap)
- [📄 License](#-license)

## ✨ Features

### 🎯 Form Builder
- **Multi-Step Forms** — Typeform-style one-question-at-a-time experience with smooth animations
- **15 Field Types** — Short Text, Long Text, Number, Date, Single Choice, Multiple Choice, Yes/No, Rating, Image/Icon Select, File Upload, Email, Phone, Website URL, Address, Consent/GDPR
- **Conditional Logic** — Show/hide steps based on previous answers (equals, contains, is set, etc.)
- **Smart Defaults** — Selecting a field type auto-fills question, label, and placeholder
- **Visual Editor** — Collapsible question cards, reorder, visual field type picker with icons
- **Emoji/Icon Picker** — Built-in category-based emoji selector for Image/Icon Select fields
- **Landing Page Mode** — Add logo, headline, and subline on top of the form
- **Footer Links** — Add up to 3 links (Privacy Policy, Imprint, Terms) below the form
- **Theme Customization** — Colors, custom CSS, animated backgrounds, and branding per form
- **Animated Backgrounds** — 4 stylish CSS motion presets (Waves, Bubbles, Aurora, Geometric) with 2-color support
- **Configurable Button Position** — Place the "Next" button in the footer bar or inline below the input field
- **Enter Key Hint** — Optional "press Enter" keyboard shortcut hint next to the Next button
- **GDPR-Ready** — Consent checkbox auto-appended to the last step (form-level toggle)
- **File Uploads** — Drag & drop with configurable file types and size limits


<img width="1017" height="672" alt="grafik" src="https://github.com/user-attachments/assets/1265603a-4602-44e6-97b0-15c77afb9456" />
<img width="1502" height="1041" alt="grafik" src="https://github.com/user-attachments/assets/cc4e4a66-ee1b-4147-bd01-e5ae46230132" />


### 📊 Data & Integrations
- **Webhook Support** — POST/PUT submission data to any URL with optional HMAC signing
- **📧 Email Notifications** — SMTP-based alerts with beautiful HTML submission tables
- **📝 Google Sheets (Simple)** — Via Google Apps Script — no service account needed, just paste a URL
- **📝 Google Sheets (Service Account)** — Auto-append rows via service account for advanced setups
- **CSV Export** — Download all submissions as CSV
- **Test Button** — Verify each integration with sample data before going live

### 📈 Analytics Dashboard
- **Conversion Funnel** — Views → Starts → Completions with conversion rates
- **Step Drop-off** — See where users abandon the form
- **Daily Trends** — Visual chart of form activity over time
- **Per-Form Stats** — Detailed analytics for each form

### 🔌 Embedding & Tracking
- **iframe Embed** — Drop forms into any landing page (with auto-resize)
- **Editable URL Slug** — Rename a form's URL anytime (`/f/spring-launch` instead of the auto-generated 8-char code); old links keep working via 301-style redirect
- **Custom Subdomain** — Host each form on its own subdomain of a domain you control (e.g. `acme.forms.example.com`), backed by a single wildcard TLS cert
- **🏷️ GTM Integration** — Google Tag Manager per form, with step and submit events
- **WordPress Plugin** — Shortcode `[openflow]`, WPBakery element, and Gutenberg block

### 🛠️ Infrastructure
- **🐳 Docker** — One command to start )
- **SQLite** — Zero-config database, no external DB needed
- **🛡️ Rate Limiting** — Built-in in-memory spam protection
- **👥 Multi-User** — Admin can invite users, assign roles (admin/user)
- **🔑 API Tokens** — Read-only tokens for programmatic API access (e.g. the lodgely connector); created under Settings, hashed at rest, revocable anytime
- **💾 Backup & Restore** — Admins can download a full JSON snapshot of the database and restore it later; older backups are auto-migrated to the current format on restore
- **🌙 Dark Mode** — Auto/light/dark theme toggle for the admin interface
- **🛡️ Delete Protection** — Published forms require typing the form name to confirm deletion
- **Responsive** — Optimized for mobile and desktop

---

## 🚀 Quick Start

```bash
git clone https://github.com/vidual-labs/openflow.git
cd openflow
docker compose up -d --build
```

The app runs on `http://localhost:3000`.

**🔑 Default Login:**
- Email: `admin@openflow.local`
- Password: `admin123`

---

## 🔄 Updating

To update an existing Docker installation:

```bash
cd openflow
git pull
docker compose up -d --build
```

Your data is safe — the SQLite database is stored in a Docker volume (`db-data`) and persists across rebuilds.

> 💡 To fully recreate the container (e.g. after major changes): `docker compose down && docker compose up -d --build`
> ⚠️ To reset everything including data: `docker compose down -v && docker compose up -d --build`

---

## ⚙️ Configuration

Environment variables (in `.env` or docker-compose):

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `change-me-in-production` | 🔐 JWT Signing Key |
| `ADMIN_EMAIL` | `admin@openflow.local` | 👤 Admin email |
| `ADMIN_PASSWORD` | `admin123` | 🔑 Admin password (only on first start) |
| `DB_PATH` | `/app/data/openflow.db` | 💾 SQLite database path |
| `PORT` | `3000` | 🌐 Server port |

---

## 🏗️ Architecture

```
openflow/
├── backend/                # 🟢 Express API + SQLite
│   └── src/
│       ├── index.js        # Server entry point
│       ├── models/         # DB, Rate Limiting, Integrations engine
│       ├── middleware/      # JWT Auth
│       └── routes/         # API endpoints
├── frontend/               # ⚛️ React (Vite)
│   └── src/
│       ├── components/     # FormRenderer, IntegrationsPanel
│       ├── pages/          # Admin + Public Views
│       └── styles/         # CSS
├── wordpress-plugin/       # 🔌 WordPress integration
│   └── openflow/
│       ├── openflow.php    # Shortcode + WPBakery + Gutenberg
│       └── block.js        # Gutenberg block editor
├── Dockerfile
└── docker-compose.yml
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
| ☑️ Single Choice | Choose one option | ✓ |
| ✅ Multiple Choice | Choose multiple options | |
| 👍 Yes / No | Binary choice | ✓ |
| ⭐ Rating | Star rating (configurable 3-10) | |
| 🖼️ Image / Icon Select | Visual grid with emoji picker or image URLs (1:1 recommended) | ✓ |
| 📎 File Upload | Drag & drop with configurable types and size limit | |

**Contact & Data Fields:**

| Type | Description | Sub-fields |
|------|-------------|------------|
| 📧 Email Address | Email with validation | |
| 📞 Phone Number | Phone number input | |
| 🌐 Website URL | URL with validation | |
| 🏠 Address | Composite address field | Street, Postal Code, City, Country |
| 🔒 Consent / GDPR | Checkbox with configurable legal text | |

---

## 🔗 Integrations

Configure integrations per form in the **Integrations** tab of the form editor.

### 🔗 Webhook
Send submission data to any URL on each submission.
- Configurable HTTP method (POST/PUT)
- Optional HMAC-SHA256 signing with shared secret
- Payload includes `formId`, `formTitle`, `data`, `timestamp`

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

---

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
| `openflow_submit` | Form submitted | `formId`, `formTitle` |

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
- `GET /api/public/form/:slug` — Load published form
- `POST /api/public/form/:slug/submit` — Submit response
- `POST /api/public/track` — Track analytics event

### Admin (auth required)
- `POST /api/auth/login` — Log in
- `GET /api/forms` — List all forms
- `POST /api/forms` — Create form
- `PUT /api/forms/:id` — Update form
- `DELETE /api/forms/:id` — Delete form
- `GET /api/submissions/:formId` — Get submissions (paginated)
- `GET /api/submissions/:formId/export` — CSV export

### Integrations (auth required)
- `GET /api/integrations/:formId` — List integrations
- `POST /api/integrations/:formId` — Create integration
- `PUT /api/integrations/:formId/:id` — Update integration
- `DELETE /api/integrations/:formId/:id` — Delete integration
- `POST /api/integrations/:formId/:id/test` — Test integration

### Analytics (auth required)
- `GET /api/analytics/overview` — Overview stats for all forms
- `GET /api/analytics/:formId` — Detailed analytics for a form

### User Management (admin only)
- `GET /api/auth/users` — List all users
- `POST /api/auth/users` — Create/invite user
- `PUT /api/auth/users/:id` — Update user role/password
- `DELETE /api/auth/users/:id` — Delete user

---

## 🧑‍💻 Development

```bash
# Start backend
cd backend && npm install && npm run dev

# Start frontend (in new terminal)
cd frontend && npm install && npm run dev
```

Frontend dev server: `http://localhost:5173` (proxies API to port 3000)

---

## 🗺️ Roadmap

- ✅ **Phase 1**: Multi-step forms, field types, Admin UI, GTM, iframe embed, CSV export, WordPress plugin
- ✅ **Phase 2**: Webhook, email notifications, Google Sheets integration
- ✅ **Phase 3**: Conditional logic, file uploads, custom CSS per form, multi-user support, landing page header/footer
- ✅ **Phase 4**: Analytics dashboard, simplified Google Sheets, dark mode, delete protection for live forms
- 🔜 **Phase 5**: A/B testing, custom domain support, form templates

---

## 📄 License

GPL 3.0

Not for use with weapons, fossil fuels or right wing politics.

---

<p align="center">
  <sub>🤖 Vibecoded with <a href="https://anthropic.com">Claude Opus 4.6</a> by Anthropic</sub>
</p>
