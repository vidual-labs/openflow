# 🌊 OpenFlow
version  0.2

## ✨ Features

### 🎯 Form Builder
- **Multi-Step Forms** — Typeform-style one-question-at-a-time experience with smooth animations
- **14 Field Types** — Text, Email, Phone, Textarea, Number, Date, Single Select, Multi Select, Yes/No, Rating, Website URL, Contact Details, Consent/GDPR, Image/Icon Select
- **Visual Editor** — Reorder questions, define options, set required fields
- **Theme Customization** — Colors and branding per form
- **GDPR-Ready** — Built-in consent checkbox field with configurable text

### 📊 Data & Integrations
- **Webhook Support** — POST/PUT submission data to any URL with optional HMAC signing
- **📧 Email Notifications** — SMTP-based alerts with beautiful HTML submission tables
- **📝 Google Sheets** — Auto-append rows to a spreadsheet via service account
- **CSV Export** — Download all submissions as CSV
- **Test Button** — Verify each integration with sample data before going live

### 🔌 Embedding & Tracking
- **iframe Embed** — Drop forms into any landing page (with auto-resize)
- **🏷️ GTM Integration** — Google Tag Manager per form, with step and submit events
- **WordPress Plugin** — Shortcode `[openflow]`, WPBakery element, and Gutenberg block

### 🛠️ Infrastructure
- **🐳 Docker** — One command to start (`docker compose up -d`)
- **SQLite** — Zero-config database, no external DB needed
- **🛡️ Rate Limiting** — Built-in in-memory spam protection
- **Responsive** — Optimized for mobile and desktop

---

## 🚀 Quick Start

```bash
git clone https://github.com/vidual-labs/openflow.git
cd openflow
docker compose up -d --build
```

> 💡 No BuildX required — works with plain `docker compose`.

The app runs on `http://localhost:3000`.

**🔑 Default Login:**
- Email: `admin@openflow.local`
- Password: `admin123`

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

| Type | Description | Auto-advance |
|------|-------------|:---:|
| 📝 Text | Single-line text input | |
| 📧 Email | Email with validation | |
| 📞 Phone | Phone number input | |
| 📄 Textarea | Multi-line text | |
| 🔢 Number | Numeric input with min/max | |
| 📅 Date | Date picker | |
| ☑️ Single Select | Choose one option | |
| ✅ Multi Select | Choose multiple options | |
| 👍 Yes / No | Binary choice | ✓ |
| ⭐ Rating | Star rating (1-5+) | |
| 🌐 Website URL | URL with validation | |
| 👤 Contact Details | Name, email, phone, company composite | |
| 🔒 Consent / GDPR | Checkbox with configurable legal text | |
| 🖼️ Image / Icon Select | Visual grid with emoji, text, or image URLs | ✓ |

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

### 📊 Google Sheets
Auto-append each submission as a new row in a Google Sheet.
- Uses Google Service Account authentication
- Auto-creates header row from form field labels
- Configurable sheet name

> 💡 Each integration has an **Enable/Disable** toggle and a **Test** button to verify your setup with sample data.

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

---

## 📡 API Endpoints

### Public (no auth)
- `GET /api/public/form/:slug` — Load published form
- `POST /api/public/form/:slug/submit` — Submit response

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

- ✅ **Phase 1**: Multi-step forms, 14 field types, Admin UI, GTM, iframe embed, CSV export, WordPress plugin
- ✅ **Phase 2**: Webhook, email notifications, Google Sheets integration
- 🔜 **Phase 3**: Conditional logic, file uploads, custom CSS per form, multi-user support

---

## 📄 License

GNU 3.0

---

<p align="center">
  <sub>🤖 Vibecoded with <a href="https://anthropic.com">Claude Opus 4.6</a> by Anthropic</sub>
</p>
