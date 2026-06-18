# Changelog

All notable changes to OpenFlow are documented in this file.

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
