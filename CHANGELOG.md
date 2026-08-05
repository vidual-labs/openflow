# Changelog

All notable changes to OpenFlow are documented in this file.

## [0.22.1] - 2026-08-05

### Fixed
- **The date calendar was too tall for landing-page embeds** — day cells are square so the selected day stays a circle and the range band runs unbroken, but nothing capped their width, so a wide container made every row as tall as the cells were wide: in a 630px-wide frame each cell grew to about 80px and the six rows alone ran close to 500px, pushing the Next button out of the iframe. The cell size is now fixed and the month capped at seven of them, and the calendar shrinks to the width of the months it holds so the ‹ › arrows sit beside the month title instead of drifting to the edges of the container. In the reported embed the whole step, footer included, now fits without scrolling. Short frames get smaller cells still, keyed off `max-height` — inside an iframe that resolves against the frame, not the device.

### Changed
- **Date steps now say what they are asking for** — a bare grid of days doesn't communicate whether one date or two are wanted, and visitors on a range step were picking a single day and moving on. Every date step now carries a short line above the calendar — "Choose a start and an end date" or "Choose a day", localized — and range steps show the **From** / **To** pair from the outset with empty slots, so two labelled blanks make it obvious that two dates are expected. The line is omitted when the builder has written their own step description, so it never duplicates their wording.

## [0.22.0] - 2026-08-05

### Added
- **Number steps got a stepper with large +/− buttons and an optional start value** — the number field was a bare `<input type="number">`, so the only way to answer was to type, or to aim at the browser's tiny native spinner arrows. It now renders thumb-sized **+** and **−** buttons either side of the value, which respect the step's **Min** and **Max** and disable themselves at either bound. Two new settings sit next to Min/Max in the editor: **Step size**, how much one click moves the number, and **Start value**, an optional prefill for questions where 0 or 1 is an unlikely answer ("how many guests?") — the field opens on that number, so the visitor is a few clicks from the right one instead of starting from an empty box. The prefilled value is a real answer from the first moment: it is submitted even if the visitor never touches the step, and the flat-rate pricing filter can already act on it. A **Hide the +/− buttons** toggle restores the plain input for steps where typing is the point.
- **Date steps now show a calendar from the start, and can ask for a timeframe** — the date field used to be an `<input type="date">` that hid its calendar behind a small native icon and looked different in every browser. The step now renders an inline calendar that is visible the moment the visitor arrives. A new **Selection mode** setting decides what the step asks for: **Single day**, or a **Date range (from – to)**, where the first click sets the start, the second the end, and the days in between are highlighted as one band. Range steps show two months side by side on wide screens and one on narrow ones. The window of selectable days can be limited with **Earliest date**, **Latest date** and a **Don't allow dates in the past** toggle. Month and weekday names follow the form's language, including whether the week starts on Monday or Sunday.
  A single day is still stored as `2026-08-10`, exactly as before, so existing date steps and everything reading their answers are unaffected. A range is stored as one string, `2026-08-10 – 2026-08-14`, which means CSV export, webhooks, e-mail notifications, Google Sheets and the lodgely connector need no changes. Picking a start but no end is caught with its own message rather than passing as a finished answer.

### Fixed
- **Typing `0` into a number step blanked the field** — the value was rendered with `value || ''`, and `0` is falsy, so a legitimate zero erased itself as soon as it was entered. The same falsy check also hid a configured **Min** of `0` in the editor.

## [0.21.3] - 2026-08-04

### Fixed
- **The "press Enter" hint showed on click-only choice steps** — single choice, multiple choice, yes/no, rating and image select are answered by clicking an option, and the click already advances the step, so telling the visitor to press Enter was meaningless. The hint is now suppressed on any step that advances on the click itself. It still appears on choice steps that genuinely wait for the button — when **auto-advance is disabled** in the theme, or on a multiple-choice step with an "Other" free-text box — since Enter is the shortcut to continue there.
- **Enter on a focused option button skipped the step instead of selecting** — the renderer's Enter handler ran on the bubbled keypress and called `preventDefault()`, which swallowed the button's own activation. Keyboard visitors tabbing through the options jumped forward without their answer being recorded. Enter aimed at a button or link now activates that element and is left alone.

## [0.21.2] - 2026-08-04

### Fixed
- **The "press Enter" hint disappeared in small embeds** — the hint was hidden by a `max-width: 600px` media query. Inside an iframe such a query resolves against the iframe's own width, not the device's, so any narrow embed dropped the hint on desktop, where the Enter key does work. Hiding is now keyed off `(hover: none) and (pointer: coarse)`, which targets touch devices without a physical keyboard regardless of the frame's size; in narrow frames the hint just renders slightly smaller.
- **Footer and button rows could overflow in narrow embeds** — the navigation footer and the inline/below-input button rows now wrap instead of pushing the Next button and the Enter hint out of the visible area.

## [0.21.1] - 2026-08-04

### Fixed
- **Custom CSS was not applied to the end screen** ([#79](https://github.com/vidual-labs/openflow/issues/79)) — the end screen returned early from a separate branch that rendered neither the form's Custom CSS `<style>` block, the `embedded` class nor the animated background, so end-screen styling could not be overridden at all. It now renders the same shell as the question screens.
- **Placeholders, borders and muted labels were unreadable on dark themes** ([#80](https://github.com/vidual-labs/openflow/issues/80)) — placeholder text, input underlines, option and rating borders, the progress track, the step counter, the back button, the file dropzone and the end-screen message were all painted in hardcoded black tints, so they disappeared against a dark **Background Color**. These tones are now mixed from the theme's **Text Color** via a new `--form-text-rgb` variable and stay legible on any background. Custom address sub-field labels, which were likewise hardcoded dark, now follow the theme text color.
- **Editor panels rendered light in dark mode, leaving their text unreadable** — the "Other" option, flat-rate pricing, image/icon and address sub-field panels in the form editor, plus several integration callouts, used hardcoded light backgrounds while their text inherited the dark-mode near-white body color. They now use `--panel`/`--panel-alt` surface tokens and theme-aware tints. This generalises the single-callout fix from 0.19.1.

## [0.21.0] - 2026-08-04

### Added
- **Optional "Other" free-text field for Multiple Choice** — multiple-choice steps have a new "Add an 'Other' option with a free-text field" toggle in the editor. When enabled, the form shows an extra choice that reveals a text box; the visitor may pick it and type an answer the configured options don't cover. Both the option's label and the text box's placeholder are customisable (defaulting to the localised "Other" / "Please specify..."). The typed text is stored as a normal entry in the step's answer array, so submissions, CSV exports, webhooks, email and Google Sheets need no special handling. Steps with the "Other" box never auto-advance, since every keystroke changes the answer and would otherwise jump to the next step mid-sentence.

## [0.20.0] - 2026-07-15

### Added
- **Ctrl/Cmd+Enter to advance from long-text fields** — long-text (textarea) steps previously required clicking the Next/Submit button, since plain Enter needs to stay free for line breaks. They now also advance on Ctrl+Enter (Windows/Linux) or ⌘+Enter (Mac), matching the shortcut convention from chat and note-taking apps. The optional "Enter Key Hint" now shows the right shortcut per field type (`Enter ↵` for regular fields, `Ctrl + Enter` / `⌘ + Enter` for long-text fields).

## [0.19.1] - 2026-07-15

### Fixed
- **Deleting a webhook (or other integration) with delivery history failed** — `integration_deliveries` rows reference their integration via a foreign key, so deleting an integration that had already attempted at least one delivery violated the constraint and the API returned a non-JSON error page instead of a clean response. The delete route now clears the integration's delivery history first, in the same transaction.
- **Google Ads integration setup tip was unreadable in dark mode** — the tip box didn't set an explicit text color, so it inherited the dark-mode near-white body text on its light background. It now uses an explicit dark text color regardless of theme.

## [0.19.0] - 2026-07-14

### Added
- **Google Ads (Server-Side Conversion) integration** — a new integration type uploads qualifying leads as offline conversions to Google Ads via the [Data Manager API](https://developers.google.com/data-manager/api), Google's OAuth2-only successor to the legacy per-click conversion upload API. OpenFlow now captures `gclid`/`gbraid`/`wbraid` from a form's landing URL (gated behind the same cookie-consent setting already used for GTM) and stores it on the submission; a submission without a captured click ID is skipped by this integration rather than uploaded. Configured with a manually-pasted OAuth client ID/secret/refresh token, Google Ads customer ID, and conversion action ID — no developer token required. The integration's "Test" button validates the OAuth credentials only, since a synthetic test submission has no real click ID to upload.

## [0.18.0] - 2026-07-13

### Added
- **Auto-redirect on End Screen** — the End Screen's Redirect URL now has an "Automatically open this URL when the form is submitted" toggle. When enabled, submission navigates the visitor straight to the URL instead of waiting for a click. The redirect (and the existing "Continue" link) target the top-level browsing context (`window.top` / `target="_top"`), so an embedded form breaks out of its iframe rather than navigating only within it.

## [0.17.1] - 2026-07-03

### Changed
- **README** — Documented the 0.17.0 scheduled-backup and integration-delivery-retry env vars/endpoints, and condensed the Table of Contents into a single compact line.

## [0.17.0] - 2026-07-03

### Added
- **Scheduled backups** — a background scheduler writes a full DB backup on an interval (`BACKUP_INTERVAL_HOURS`, default 24h) with automatic pruning (`BACKUP_RETENTION_COUNT`, default 14), so recovery no longer depends on someone remembering to click "Download backup". `docker-compose.yml` now mounts a separate `./backups` bind mount (`BACKUP_DIR`) so backups survive even if the `db-data` volume is lost or corrupted. New admin endpoints `GET /api/admin/backups` and `GET /api/admin/backups/:filename` list/download scheduled backups. Set `BACKUP_ENABLED=false` to disable.
- **Retrying integration deliveries with dead-letter visibility** — submissions to a form with a webhook/email/Google Sheets integration are now persisted as a delivery record before being sent. A failed delivery (client webhook down, SMTP hiccup) is retried with backoff (1m/5m/30m/2h/6h) instead of being silently dropped; after all retries are exhausted it's marked as a dead letter. The Integrations tab shows a banner for any failing/dead deliveries with a manual "Retry now" action, so a bad campaign lead can't vanish unnoticed. New endpoints: `GET /api/integrations/:formId/deliveries`, `POST /api/integrations/:formId/deliveries/:deliveryId/retry`.

## [0.16.2] - 2026-07-03

### Fixed
- **"Invalid JSON response" on every admin write request out of the box** — the CORS allowlist added in 0.16.0 rejected the browser's `Origin` header unless it exactly matched an explicitly configured `OPENFLOW_PRIMARY_HOST`/`CORS_ORIGINS` value, which broke same-origin requests (including through Vite's dev proxy, and any default single-service production deployment) for every non-GET admin API call — e.g. saving Settings. The rejection also threw synchronously, crashing to Express's HTML error page instead of a JSON response. Replaced with hand-written middleware that always allows requests whose `Origin` host matches the request's own `Host` (true same-origin) and never throws.

## [0.16.1] - 2026-07-03

### Fixed
- **Stale version number in the admin sidebar footer** — it was a hardcoded string (`0.13.0`) that had drifted out of sync with the actual app version. Now derived from `package.json` at build time so it can't go stale again.

## [0.16.0] - 2026-07-03

### Security

Hardening pass across the app following a full security audit (production deployments store real lead/PII data). No breaking API changes; a few defaults changed to be safe-by-default.

- **No more insecure default secrets** — `JWT_SECRET` is auto-generated and persisted (instead of falling back to a hardcoded string) if not set explicitly, and a missing `ADMIN_PASSWORD` now generates and prints a random one-time password on first boot instead of the well-known `admin123`.
- **Fixed critical stored XSS** — the GTM container ID field was interpolated unescaped into a raw `<script>` tag on public form/embed pages; it's now validated against `GTM-XXXXXXX` both client- and server-side.
- **Login brute-force protection** — `/api/auth/login` (and user-invite/token-creation) are now rate limited; only failed login attempts consume the throttle budget, so legitimate rapid logins are unaffected. Login responses no longer leak account existence via timing.
- **SSRF protection on integrations** — webhook and Google Apps Script URLs are validated to reject private/internal/loopback network destinations before the server fetches them.
- **CSV export formula-injection fix** — submission export cells starting with `=`, `+`, `-`, or `@` are neutralized so opening the file in Excel/Sheets can't trigger formula execution.
- **CORS locked down** — replaced the wide-open `origin: true` (any site, with credentials) with an explicit allowlist.
- **Rate limiter can no longer be bypassed via a spoofed `X-Forwarded-For` header** on unproxied deployments.
- **Outbound notification emails now HTML-escape submitted field values**, closing an HTML-injection vector in lead emails.
- **CSS theme customization is sanitized** to strip `@import`/`url()`/`expression()` and block CSS-based data exfiltration.
- Minimum password length (10 chars) enforced when creating/updating users.
- `/api/admin/*` is now correctly blocked on per-form public subdomains.
- Public request body size limits reduced from a blanket 50MB to right-sized per-route limits.
- WordPress plugin: Gutenberg block rendering no longer round-trips through re-serialized shortcode syntax.

## [0.15.1] - 2026-07-02

### Changed
- **Editable lodgely link button text** — The lodgely link on the Email Notification integration now has an optional "Button text" field, so admins can customize the call-to-action (e.g. "View lead in lodgely") instead of the fixed "Open in lodgely" label. Falls back to "Open in lodgely" when left blank.

## [0.15.0] - 2026-07-02

### Added
- **Optional lodgely link in lead emails** — The Email Notification integration has a new "Include a link to lodgely in this email" toggle plus a lodgely URL field, both off/empty by default. When enabled, each lead notification email includes a button linking to the admin's lodgely instance, so clients who prefer email can still jump straight into lodgely. Per-integration setting, configured in **Integrations → Email Notification** on each form.

## [0.14.0] - 2026-06-24

### Added
- **Read-only API tokens** — Mint long-lived API tokens under **Settings → API Tokens** for programmatic API access (e.g. the [lodgely](https://github.com/vidual-labs/lodgely) connector) without sharing your password. Tokens are `ofw_`-prefixed, stored only as a SHA-256 hash (shown in plaintext once at creation), and are **read-only**: the auth middleware authenticates the owning user but rejects any non-GET request made with a token. Tokens can be listed and revoked individually; a token can never be used to manage tokens. New endpoints: `GET/POST /api/auth/tokens`, `DELETE /api/auth/tokens/:id`.

## [0.13.1] - 2026-06-24

### Docs
- **Documented the lodgely integration** — A new "lodgely (lead intake hub)" subsection in the README and a note in `CLAUDE.md` explain that [lodgely](https://github.com/vidual-labs/lodgely) can *pull* a form's submissions into a specific client by signing in to the admin API and reading `GET /api/submissions/:formId`. Configured entirely on the lodgely side; nothing to set up in OpenFlow beyond an admin account. No code changes.

## [0.13.0] - 2026-06-18

### Added
- **"Require at least one" for combined steps** — A combined (two-question) step can now require that the visitor answers *at least one* of its two fields (e.g. email **or** phone), via a new toggle in the editor. Each field's own **Required** toggle still works for forcing that specific field. Enforced both client-side and on the server.

### Fixed
- **Sidebar no longer "saws off" on long pages** — The dark sidebar is now pinned to the viewport and always fills the full height, even when the page content is taller than one screen (previously the background ended partway down). Fixes a layout bug where `.admin-main` was capped at `100vh`.
- **Admin content is left-aligned again** — Reverted the centered content area introduced in 0.12.0; on wide screens the content now sits next to the sidebar instead of floating in the middle.
- **Aligned sidebar and content tops** — The sidebar logo and the page header now start at the same height for a cleaner, consistent top edge, and page-header actions are vertically centered.

## [0.12.0] - 2026-06-18

### Added
- **Clone a form** — A new **Duplicate** action on the Forms dashboard copies a form's structure (questions, theme, end screen) and its integrations in one click via `POST /api/forms/:id/clone`. The copy is created as a draft with a fresh URL and a "(Copy)" title; submissions and analytics are never carried over, and copied integrations are created **disabled** so a clone can't send leads to live destinations until you review and re-enable them.
- **Combine two questions into one step** — Questions can now be merged so two fields (e.g. email + phone) appear on a single screen. Use the **Combine** buttons in the editor to group a question with the one above or below it, and **Split** to separate them again — fully reversible. Combined steps validate every field before advancing, and each field keeps its own column in the submissions table, CSV export and integrations.

### Changed
- **Refreshed, more consistent admin UI** — Page headers, alert banners, and empty/loading states are now shared components for a consistent look across every admin page; content is centred on wide screens, the active sidebar item is clearer, hardcoded colours were replaced with theme tokens (better dark mode), and the form-title field no longer overflows on small screens.
- **New OpenFlow logo mark** — A custom "flow" icon replaces the old glyph in the sidebar and login screen, and ships as the browser favicon.

## [0.11.2] - 2026-06-16

### Fixed
- **Restored forms invisible after cross-deployment restore** — When an admin restored a backup onto a fresh deployment where their account had a different UUID, all their forms were orphaned (the `user_id` still pointed to the old UUID). The restore logic now detects this ID mismatch and reassigns the forms to the acting admin's current UUID automatically.

## [0.11.1] - 2026-06-15

### Added
- **Restore can't lock you out** — When an administrator restores a backup, their own account is now preserved: it is re-inserted with its original id and credentials and keeps the admin role, even if the backup omits it or contains a conflicting account. This guarantees the admin performing the restore stays logged in and can still reach the admin panel afterwards.

## [0.11.0] - 2026-06-14

### Added
- **Full database backup & restore (admin only)** — A new **Backup** tab in the admin sidebar lets administrators download a complete JSON snapshot of the database (forms, submissions, integrations, analytics, users, settings and slug history) and restore from a previous snapshot. Restore runs inside a single transaction, so a malformed or partial file leaves existing data untouched. New admin-only endpoints: `GET /api/admin/backup` (download), `GET /api/admin/backup/info` (row-count summary) and `POST /api/admin/restore`.
- **Backup format migrations** — Backups carry a format version and are migrated up to the current schema on restore, so a snapshot taken on an older release can be restored on a newer one. Legacy versionless backups are upgraded by filling in defaults (e.g. the `role` column), and during insert each row is matched against the live table columns so added/removed columns are tolerated. Restoring a backup created by a *newer* server is refused with a clear error.

## [0.10.1] - 2026-05-23

### Fixed
- **Deleted forms locked their old slugs forever** — `DELETE /api/forms/:id` did not clean up the `slug_history` table, so rows referencing a deleted form remained behind and caused the rename-conflict check to return 409 for any other form trying to reuse those slugs. The delete transaction now removes the form's history rows.
- **`trust proxy` was set unconditionally** — Setting `trust proxy: true` when no reverse proxy is in front allows any client to spoof `req.ip` via `X-Forwarded-For`, which affects in-memory rate limiting. The setting is now enabled only when `OPENFLOW_PRIMARY_HOST` is configured (the same condition that triggers subdomain routing, which requires Caddy in front).

## [0.10.0] - 2026-05-23

### Added
- **Per-form subdomain hosting** — Each form can now be served on its own subdomain of an operator-controlled parent host (e.g. `acme.forms.example.com`). Set `OPENFLOW_PRIMARY_HOST` and the Embed tab gains a "Custom subdomain" field next to the form URL. Requests to a configured subdomain receive an injected form identity in `index.html`; the SPA boots in form-only mode, admin APIs return 404, and the URL bar stays at `/`. A new `Caddyfile` plus opt-in `docker-compose.subdomains.yml` overlay terminates TLS with a single wildcard certificate via the Let's Encrypt DNS-01 challenge — one cert covers every form, no per-tenant verification or on-demand TLS required. Validation reuses the slug grammar `[a-z0-9-]{3,60}` and applies a hostname-specific reserved-word blocklist (`www`, `api`, `admin`, `mail`, …) to prevent conflicts.

## [0.9.0] - 2026-05-20

### Added
- **Editable form URL slug** — Form owners can now change the URL slug under the Embed tab (e.g. `/f/spring-2026-launch` instead of the auto-generated 8-character code). Slugs accept lowercase letters, digits, and hyphens, must be 3–60 characters, and a reserved-word blocklist (`admin`, `api`, `login`, etc.) prevents conflicts. Previously shared URLs keep working: when a slug is changed, the old one is recorded in a new `slug_history` table and the public form route transparently serves the form via either alias, with the response always carrying the current canonical slug so `/f/...` and `/embed/...` redirect to the new URL.

## [0.8.2] - 2026-05-19

### Added
- **Custom address field labels** — Form builders can now set their own placeholder text for each core address sub-field (Street, Postal Code, City, Country) directly in the field editor. Labels fall back to the locale defaults when left blank, so existing forms are unaffected.

## [0.8.1] - 2026-05-19

### Fixed
- **Flat-rate pricing filter — options appeared pre-selected and unclickable** — When the flat-rate pricing filter was enabled on a select/multi-select field, every option in the live form rendered with the "selected" highlight and clicking a choice never advanced the form. Options stored in pricing-filter mode are `{ label, maxBudget }` objects with no `value` field, so `opt.value` was `undefined` for every option; `value === undefined` then matched every button and `onChange(undefined)` failed the required-field check. `SelectInput` and `MultiSelectInput` now fall back to `opt.label` when `opt.value` is absent.
- **Backend status endpoint reported stale version** — `GET /` returned a hardcoded `0.7.6` even though the project was at 0.8.0. The version is now read from `package.json` so it can never drift again.

## [0.8.0] - 2026-05-14

### Added
- **White-label branding settings** — A new admin-only "Settings" page (sidebar → Settings) lets admins customise the sidebar logo: replace it with any custom logo URL, or hide it entirely. Settings are persisted in a new `site_settings` database table and served via `GET /api/settings` (public) / `PUT /api/settings/:key` (admin-only). The sidebar logo in `App.jsx` is now fully dynamic.

## [0.7.9] - 2026-05-13

### Added
- **Form language setting (EN / DE)** — A new "Form Language" dropdown in the Design tab → "Button & Navigation" lets admins switch the public form UI to German. All respondent-facing strings are translated: button labels (Next/Weiter, Submit/Absenden), validation errors, Yes/No choices, address field placeholders, file upload prompts, the end-screen thank-you message, the Enter-key hint, and the consent checkbox default text. English is the default; the custom Next/Submit button label fields still take precedence over locale defaults. New translations can be added to `frontend/src/locales.js`.

## [0.7.8] - 2026-05-13

### Added
- **Editable Next/Submit button labels** — The Design tab's "Button & Navigation" section now exposes "Next Button Label" and "Submit Button Label" fields. Leave blank to keep the defaults ("Next →" / "Submit →"). Labels are stored in the form theme and reflected immediately in the live preview.

### Fixed
- **Choice option editing — cannot re-add deleted lines** — Deleting all characters from a choice option line and pressing Enter to add a new option was silently no-oped because `filter(Boolean)` stripped the trailing blank line before the textarea re-rendered. The options editor now uses local state so trailing newlines are preserved while typing, allowing new options to be added freely again.

## [0.7.7] - 2026-05-13

### Added
- **Flat-rate Pricing Filter** — Select/single-choice fields now support a "Flat-rate Pricing Filter" option in the form editor. When enabled, link the field to any quantity field (number of guests, items, seats, etc.) and set a rate per unit. Options whose upper bound ("Max value") falls below the calculated minimum (quantity × rate) are automatically hidden from respondents. Plain string options without a ceiling are always shown, ensuring full backward compatibility.

## [0.7.6] - 2026-04-16

### Added
- **GTM Cookie Consent Banner** — When a GTM Container ID is configured, admins can now enable a cookie/tracking consent banner in the GTM / GDPR tab. GTM is only injected after the visitor accepts. All banner texts are fully editable per form: message, Accept button label, and Decline button label. Consent is persisted in localStorage so the banner doesn't reappear.
- **Live Theme Preview in Design tab** — The Design tab now shows a live preview panel that immediately reflects color and animated-background changes without needing to save or open the published form. This makes it easy to verify that animations are configured and working before publishing.

### Fixed
- **Backend: submissions DELETE returns 404** — `DELETE /submissions/:formId/:submissionId` previously returned `200 { ok: true }` even when the submission ID did not exist. It now returns `404 { error: "Submission not found" }` when no row was deleted.

## [0.7.5] - 2026-04-16

### Fixed
- **Security: admin-only user deletion** — `DELETE /users/:id` now correctly requires admin role; previously any authenticated user could delete any account
- **Security: JWT secret warning** — Server now logs a warning at startup when `JWT_SECRET` is not set in the environment
- **Backend: JSON parse safety** — `JSON.parse()` calls on stored form data in routes are now wrapped in try/catch; corrupted records return a 500 error instead of crashing the handler
- **Backend: analytics event validation** — `/api/public/track` now validates that the given `formId` exists before inserting the event (previously orphaned rows could accumulate)
- **Backend: atomic form deletion** — Cascaded deletes of submissions, integrations, and analytics events now run inside a single SQLite transaction
- **Backend: IP detection behind proxies** — Rate limiters now read `X-Forwarded-For` first, falling back to `req.ip`, so limits are correctly applied when OpenFlow runs behind a reverse proxy
- **Backend: analytics error logging** — Analytics insert failures are now logged instead of silently swallowed
- **Frontend: 401 redirect safety** — The API client now throws after redirecting to `/login` on a 401, stopping subsequent code from running with a stale session
- **Frontend: error states** — Dashboard, Analytics, FormEditor, Submissions, and IntegrationsPanel all show error messages when API calls fail instead of silently leaving the user on an empty/loading screen
- **Frontend: IntegrationsPanel double-click** — "Add integration" buttons are disabled while a creation request is in flight to prevent duplicate integrations
- **Frontend: auto-advance stale closure** — The auto-advance timer in FormRenderer now checks a step ref at fire time; it no longer advances the form if the user has already navigated to a different step in the 400 ms window

## [0.7.4] - 2026-02-23

### Changed
- **Version bump** — Updated to reflect latest release

## [0.7.3] - 2026-02-22

### Changed
- **WordPress Plugin Refactored** — Improved WordPress integration with shortcode `[openflow]`, WPBakery element, and Gutenberg block support
- **Animation Improvements** — Enhanced animated backgrounds with smoother transitions

## [0.7.2] - 2026-02-13

### Added
- **Animated Backgrounds** — 4 pure-CSS motion presets: Waves, Bubbles, Aurora, Geometric. Uses primary + accent color.
- **Button Position** — New theme option to place the "Next" button in the footer bar (default) or inline below the input field
- **Enter Key Hint** — Optional "press Enter ↵" hint displayed next to the Next button (toggle in Design tab)
- **Accent Color** — New color picker for the secondary color used in animated backgrounds (auto-derived if empty)
- **Font Family Picker** — Choose from popular web fonts (Inter, Space Grotesk, DM Sans, Plus Jakarta Sans, Georgia, Courier New)

### Changed
- **Design tab redesign** — Restructured with icon headers, descriptions, and visual card selectors (inspired by Typeform/Formbricks)
- Form layout uses proper flex-flow instead of fixed positioning — content centers naturally between header and nav
- Footer links now render above the navigation bar so controls are always the bottom-most row
- Progress bar uses absolute positioning (within container) instead of fixed

## [0.7.1] - 2026-02-12

### Fixed
- Forms with submissions, integrations, or analytics data can now be deleted (foreign key cascade)
- Dark mode no longer bleeds into public form preview — preview always uses the configured background color
- Vertical centering of form questions works correctly on all screen sizes

### Changed
- Single Choice fields now auto-advance on click (like Yes/No and Image Select)
- Removed keyboard shortcuts (arrow keys, A/B/C letter keys) from selection fields — focus ring was visible and confusing
- Nav bar in form preview uses the form's configured background color

### Added
- Delete protection for published forms: requires typing the form name to confirm

## [0.7.0] - 2026-02-12

### Added
- Dark mode for admin interface (auto/light/dark toggle)
- Preview button in form editor
- Analytics event tracking improvements

## [0.6.0] - 2026-02-12

### Added
- Analytics dashboard with conversion funnel, step drop-off, and daily trends
- Simplified Google Sheets integration via Apps Script (no service account needed)

## [0.5.0]

### Added
- Conditional logic (show/hide steps based on previous answers)
- File upload field type with drag & drop
- Custom CSS per form
- Multi-user support with admin/user roles
- Landing page header (logo, headline, subline) and footer links

## [0.4.0]

### Added
- Webhook integration with optional HMAC signing
- Email notifications via SMTP
- Google Sheets integration via service account

## [0.3.0]

### Added
- GTM integration per form with step and submit events
- GDPR consent checkbox on last step
- iframe embed with auto-resize
- WordPress plugin (shortcode, WPBakery, Gutenberg)

## [0.2.0]

### Added
- Multi-step form builder with 15 field types
- Admin UI with form management
- CSV export of submissions
- Rate limiting
