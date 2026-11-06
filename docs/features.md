<sub>[← README](../README.md) · [All docs](README.md)</sub>

# Features

Everything OpenFlow does, grouped. The [README](../README.md) has the short version.

<p align="center"><img src="assets/readme/form-flow.svg" alt="Animated example of a multi-step form" width="380"></p>

## 🎯 Form Builder
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

## 📊 Data & Integrations
- **Webhook Support** — POST/PUT submission data to any URL with optional HMAC signing
- **📧 Email Notifications** — SMTP-based alerts with beautiful HTML submission tables
- **📝 Google Sheets (Simple)** — Via Google Apps Script — no service account needed, just paste a URL
- **📝 Google Sheets (Service Account)** — Auto-append rows via service account for advanced setups
- **🎯 Google Ads (Server-Side Conversion)** — Upload leads with a captured `gclid`/`gbraid`/`wbraid` as offline conversions via Google's Data Manager API
- **📣 Meta Conversions API** — Send a server-side `Lead` event to Facebook/Instagram Ads on every submission, no Meta Pixel required; matches leads to ad clicks via `fbclid`, and deduplicates against a Meta Pixel via a shared event ID
- **CSV Export** — Download all submissions as CSV
- **Test Button** — Verify each integration with sample data before going live

## 📈 Analytics Dashboard
- **Conversion Funnel** — Views → Starts → Completions with conversion rates
- **Step Drop-off** — See where users abandon the form
- **Daily Trends** — Visual chart of form activity over time
- **Per-Form Stats** — Detailed analytics for each form

## 🔌 Embedding & Tracking
- **iframe Embed** — Drop forms into any landing page (with auto-resize)
- **Editable URL Slug** — Rename a form's URL anytime (`/f/spring-launch` instead of the auto-generated 8-char code); old links keep working, and the browser is rewritten to the current URL
- **Custom Subdomain** — Host each form on its own subdomain of a domain you control (e.g. `acme.forms.example.com`), backed by a single wildcard TLS cert
- **🏷️ GTM Integration** — Google Tag Manager per form, with step and submit events
- **🍪 Cookie Consent Banner** — Optional banner shown *before* GTM loads, so tracking only starts once the visitor accepts
- **WordPress Plugin** — Shortcode `[openflow]`, WPBakery element, and Gutenberg block

## 🛠️ Infrastructure
- **🐳 Docker** — One command to start, from an official pre-built multi-arch image (`ghcr.io/vidual-labs/openflow`) or from source
- **SQLite** — Zero-config database, no external DB needed
- **🛡️ Rate Limiting** — Built-in in-memory spam protection
- **👥 Multi-User** — Admin can invite users, assign roles (admin/user)
- **🏷️ White-Label Branding** — Admins can swap or hide the vendor logo in the admin sidebar (**Settings → Branding**)
- **🔑 API Tokens** — Read-only tokens for programmatic API access (e.g. the lodgely connector); created by each user on their **Account** page, hashed at rest, revocable anytime
- **💾 Backup & Restore** — Admins can download a full JSON snapshot of the database and restore it later; older backups are auto-migrated to the current format on restore
- **⏰ Scheduled Backups** — A background job writes a rotating backup on an interval to a separate volume, so recovery doesn't depend on someone remembering to click "Download"
- **🔁 Retrying Integration Deliveries** — Failed webhook/email/Sheets deliveries retry with backoff instead of silently dropping the lead; exhausted retries surface as a dead letter you can manually retry from the Integrations tab
- **📋 Audit Log** — Logins (success/failure), user/role changes, settings changes, and backup/restore are recorded with actor, IP and timestamp for post-incident review (`GET /api/admin/audit-log`, admin only)
- **🔒 Server-Side Sessions** — Logging out, changing a password or role, or **Log out everywhere** on the Users page ends the session immediately; every user sees their own sessions and remembered browsers on the **Account** page and can sign out everywhere else
- **✉️ Two-Factor Login (opt-in)** — Each user can require a 6-digit code sent by e-mail when signing in from a new browser; "remember this browser" skips it for 30 days (needs system e-mail: Settings → System e-mail or `SMTP_*`)
- **🧱 Brute-Force Lockout** — Repeated failed logins lock the account for escalating periods (1 → 60 min), persisted across restarts, without locking the owner out of browsers they already use
- **🔐 Encrypted, Write-Only Integration Secrets** — SMTP passwords, Google service-account keys, OAuth client secrets/refresh tokens, Meta access tokens and webhook HMAC secrets are encrypted (AES-256-GCM) before being stored, so a leaked database file or backup JSON doesn't hand over live credentials. The API never returns them once saved — the editor only shows that one is set, and lets you replace or remove it
- **❤️ Health Check** — `GET /api/health` reports database connectivity and uptime for uptime monitors and container orchestrators
- **📊 Structured Logging** — Request, integration-delivery, and backup events are logged as single-line JSON so they can be piped into any log aggregator
- **🌙 Dark Mode** — Auto/light/dark theme toggle for the admin interface
- **🛡️ Delete Protection** — Published forms require typing the form name to confirm deletion
- **♿ Accessible Forms** — Labeled questions, announced errors, keyboard-operable file uploads, and a progress bar and choice controls exposed to assistive tech (WCAG 2.1 AA pass on `/f/:slug` and `/embed/:slug`)
- **Responsive** — Optimized for mobile and desktop

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
| 📎 File Upload | Drag & drop with configurable types and size limit (up to 37 MB per file — a submission carries the file base64-encoded and the server takes 50 MB per submission) | |

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

The per-form page compares any period with the previous one (or with the days before a flow change), and shows reach, drop-off and median time on each step plus a daily trend.
