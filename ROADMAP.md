# OpenFlow Roadmap

OpenFlow's job in the lead pipeline is the **in-session experience**:
everything a visitor sees before or at submit. Lead evaluation (scoring,
qualification, labels, assignment, reporting) belongs to
[lodgely](https://github.com/vidual-labs/lodgely). Bookings belong to
[calon](https://github.com/vidual-labs/calon). The split and the interface
between the repos are defined in the **shared section** at the end of this
file, which is duplicated in lodgely's `ROADMAP.md`.

Target use: lead generation for SMEs and client projects in the DACH region,
self-hosted and GDPR-sensitive.

Phases are ordered by value for lead-gen conversion and data quality. The
interface contract comes first because most later items depend on it.
Effort: **S** ≈ days, **M** ≈ 1–2 weeks, **L** ≈ several weeks.

| Phase | Theme | OpenFlow items | lodgely items (see its ROADMAP.md) |
|---|---|---|---|
| 0 | Shipped: security & correctness batch | done in 0.41.0 | done in 0.55.0 |
| 1 | Contract & speed-to-lead | ~~OF-1~~ (0.46.0), OF-2, OF-3, OF-4, OF-13 | LG-1, LG-2, LG-3 |
| 2 | Conversion & data at the source | OF-5, OF-6, OF-7, OF-9, OF-8 | LG-6, LG-8 |
| 3 | Lead evaluation | *(none; lodgely's phase)* | LG-4, LG-5, LG-10, LG-7, LG-9 |
| 4 | GDPR data lifecycle | OF-10, OF-11 | LG-11, LG-12, LG-13 |
| 5 | Operator scale | OF-12, OF-14, OF-15 | LG-14 (deferred) |

---

## Phase 0 — Shipped in 0.41.0

- **API tokens can no longer reach admin endpoints.** Before, an `ofw_` token
  minted by an admin could download `GET /api/admin/backup` (every submission
  plus password hashes) and list users. lodgely stores exactly these tokens.
- **`TRUST_PROXY`.** Behind a generic reverse proxy all visitors shared one
  rate-limit bucket (10 submits/min for the whole install) and the proxy IP
  was stored as the submitter IP. There is now a one-time log warning when
  it's misconfigured.
- **Secure defaults.**
  - A publicly known `JWT_SECRET` refuses to start, and a weak seed
    `ADMIN_PASSWORD` refuses to seed.
  - Admins still on a well-known default password are logged at boot and see
    a red banner in the admin UI.
  - New passwords must not be well-known defaults.
- **Consent is enforced on the server.** Arbitrary client-supplied `_*` keys
  are no longer stored or forwarded to webhooks.
- **`javascript:` URLs are rejected** for the end-screen redirect and footer
  links (on save and at render).

---

## Phase 1 — Contract & speed-to-lead

### OF-1 · Stable field keys
**Repo:** OpenFlow · **Status:** **shipped in 0.46.0** (keys follow the label until edited; conditions reference keys; CSV header stays the label, the key is the column tooltip) · **Effort:** M · **Depends on:** X-1
**Why:** lodgely maps answers by opaque `field_<timestamp>` ids today. A
re-created question silently breaks the mapping, and rows without contact data
are then dropped for good. Readable, stable keys make the mapping and the
qualification rules survive form edits.

**Acceptance criteria**
- Every leaf field (including group sub-fields and address custom fields) has
  a `key` matching `[a-z][a-z0-9_]{0,39}`, unique within the form. It is
  auto-derived from the question or type on creation and editable in the
  editor.
- Existing forms are migrated with keys derived from type/label. Existing ids
  are untouched, and submissions keep their id-keyed `data`.
- Saving a form with a duplicate or renamed key that other steps' conditions
  reference is refused (400) with the offending key named.
- The key is shown in the editor's field card and in the CSV export header
  tooltip.

### OF-2 · Versioned pull API (`/api/v1`)
**Repo:** OpenFlow · **Status:** partial (unversioned `/api/submissions`, offset paging, offset-less timestamps) · **Effort:** M · **Depends on:** X-1, OF-1
**Why:** lodgely's pull walks newest-first offset pages with 1-second
timestamp ties and guesses the timezone. A cursor-based, versioned endpoint
makes the pull gap-free and gives both repos an explicit contract to test
against.

**Acceptance criteria**
- `GET /api/v1/forms/:id/submissions?cursor=&limit=` returns the X-1
  document, ascending by `(submitted_at, submission_id)`, with `next_cursor`.
  Paging through while new submissions arrive yields each submission exactly
  once (test).
- `GET /api/v1/meta` returns `{ api_versions, app_version }`.
- All v1 timestamps are ISO 8601 UTC with `Z`. No IP, user agent or file
  contents appear in v1 responses.
- The legacy `/api/forms` and `/api/submissions` shapes are unchanged
  (regression test).

### OF-3 · Signed webhook v1
**Repo:** OpenFlow · **Status:** partial (webhook exists; no submission id, no metadata, no version, signature without timestamp) · **Effort:** S · **Depends on:** X-1, OF-1
**Why:** push is how a lead reaches lodgely in seconds instead of up to an
hour (D2). The current body can't be deduplicated and can be replayed.

**Acceptance criteria**
- A webhook integration can be set to "Contract v1". It then sends the X-1
  document with `X-OpenFlow-Event`, `X-OpenFlow-Delivery` and
  `X-OpenFlow-Signature: t=…,v1=…` (HMAC over `"<t>.<raw body>"`).
- Retries re-send byte-identical bodies with the same delivery id. The
  signature timestamp is refreshed per attempt.
- The legacy body stays the default for existing webhook integrations.
- A documented receiver snippet (Node + PHP) verifies the signature, and a
  test verifies OpenFlow's own output against it.

### OF-4 · Form-scoped API tokens
**Repo:** OpenFlow · **Status:** partial (read-only tokens; no scope, no expiry) · **Effort:** S · **Depends on:** —
**Why:** the lodgely connector needs one form's submissions, not every GET
its owner can make (analytics, integrations, CSV export of all forms).

**Acceptance criteria**
- When creating a token, the operator picks the forms it may read and,
  optionally, an expiry date. Tokens without a form list keep today's
  behaviour (owner's forms).
- A scoped token gets 404 on forms outside its list. It gets 403 on every
  route that isn't a form/submission read (analytics, integrations,
  deliveries, export).
- An `erase` scope exists for X-2 and is never granted implicitly.
- The token list shows scope, expiry and last use.

### OF-13 · Account security follow-ups
**Repo:** OpenFlow · **Status:** mostly shipped in 0.44.0 (self-service password change revoking other sessions, opt-in e-mailed 2FA codes, remembered browsers, lockout); still open: forced change on first login with a generated password, admin-enforced 2FA via env switch (TOTP was swapped for e-mailed codes) · **Effort:** S · **Depends on:** —
**Why:** every user can change their own password since 0.44.0; a generated
one-time admin password can still be kept indefinitely, and 2FA can't be
required for admins.

**Acceptance criteria**
- Every user can change their own password (current password required;
  revokes their other sessions).
- The first login with a generated one-time password forces a password
  change before anything else loads.
- Optional TOTP 2FA per user, enforceable for admins via an env switch.

---

## Phase 2 — Conversion & data at the source

### OF-5 · Answer-based routing
**Repo:** OpenFlow · **Status:** partial (show/hide per step: one `{field, op, value}` rule, no AND/OR; single end screen; one static redirect) · **Effort:** L · **Depends on:** OF-1
**Why:** relevant paths shorten forms and lift completion. Non-fit visitors
can be routed to a polite end screen, without a booking step, before they
take a sales slot (D1). All of this happens in-session, without scoring.

**Acceptance criteria**
- Conditions support groups with AND/OR and the existing operators plus
  `>`, `<` and `in`, referencing field **keys**. The server-side mirror
  (`utils/conditions.js`) evaluates the same rules, backed by a shared
  fixture test.
- A step can define "after this step, jump to step X / end screen Y" rules,
  evaluated top-down with a default. The editor refuses cycles.
- A form can have several end screens (each with its own title, message and
  optional redirect) and a rule list choosing between them.
- Redirect URLs can include answer and hidden-field placeholders
  (`https://…/thanks?plan={{plan}}`), URL-encoded and still limited to
  http(s).

### OF-6 · Hidden fields, UTM capture & answer piping
**Repo:** OpenFlow (capture) → lodgely (LG-6) · **Status:** partial (only `gclid`/`gbraid`/`wbraid`/`fbclid` are captured; no hidden fields, no piping; the WordPress plugin forwards no parameters) · **Effort:** M · **Depends on:** X-1
**Why:** without `utm_*` and partner or campaign ids, lodgely can't
attribute OpenFlow leads to campaigns. Only Meta Lead Ads leads show up in
per-campaign reporting today. Piping ("Thanks, {{first_name}}") lifts
completion.

**Acceptance criteria**
- `utm_source/medium/campaign/term/content`, `landing_url` and `referrer`
  are captured on first page view. `landing_url` and `referrer` are stored
  in submission metadata and emitted under `attribution` in the contract.
  Capture is gated by the cookie banner exactly like click ids are today.
- Operators can declare hidden fields (name + optional default). They are
  filled from same-named URL parameters and appear in answers, CSV, webhook
  and contract.
- The WordPress shortcode, WPBakery element and Gutenberg block forward the
  host page's query string to the iframe (allowlisted params only).
- `{{key}}` placeholders in question text, help text and end-screen text are
  replaced with earlier answers (escaped). A missing answer renders as empty.

### OF-7 · Spam protection
**Repo:** OpenFlow · **Status:** partial (in-memory per-IP rate limit only; `TRUST_PROXY` fixed in 0.41.0) · **Effort:** M · **Depends on:** —
**Why:** bot submissions pollute lodgely, trigger real calon bookings and
send false conversions to Google/Meta. The rate limiter alone doesn't stop
distributed bots.

**Acceptance criteria**
- A hidden honeypot field and a minimum time-to-complete (default 3 s since
  first view) are applied to every form. Hits are rejected with a generic
  error and counted in analytics as `spam`.
- Optional Cloudflare Turnstile per form (site key + secret, secret
  write-only). It is verified server-side before calon booking or storage,
  and documented as a third-party call that needs a privacy-policy mention.
- Choice answers are validated against the configured options on the server.
  File uploads are checked against `accept`/`maxSizeMB` on the server too.
- The rate limiter stays in-memory by design (single instance), but gets a
  per-form cap and documented numbers in the README.

### OF-9 · Consent record
**Repo:** OpenFlow · **Status:** partial (`_consent: true` is stored and, since 0.41.0, enforced; no text version, no timestamp; the cookie banner is only possible together with GTM) · **Effort:** S · **Depends on:** X-1
**Why:** under GDPR you must be able to show *what* a person agreed to and
*when*. A bare boolean doesn't hold up. OF-8 needs this too.

**Acceptance criteria**
- Each submission stores `consent: { given, text_hash, given_at }`. The
  exact consent text is kept once per hash, so the wording at the time of
  consent can be reproduced.
- The contract emits the `consent` block, and lodgely stores it (LG-13).
- The cookie banner can be enabled without GTM (it then gates click-id and
  UTM capture only).
- Changing the consent text in the editor shows "new version; earlier
  submissions keep the old text".

### OF-8 · Partial submissions (opt-in)
**Repo:** OpenFlow (capture) → lodgely (LG-8) · **Status:** missing (answers live only in browser state until submit) · **Effort:** L · **Depends on:** OF-9, OF-2, OF-3
**Why:** visitors who leave after entering contact details are the
highest-value lost leads. Capturing them only with explicit consent keeps it
lawful (D3).

**Acceptance criteria**
- Per-form opt-in setting. Partials are stored only after the visitor
  passed a contact step **and** ticked a dedicated, separately worded consent
  ("You may contact me even if I don't finish").
- A partial is upserted per session as `status: partial` and emitted as
  `submission.partial`. A later full submit of the same session turns it into
  `complete` (same `submission_id`) and emits `submission.completed`.
- Partials never book calon slots or fire ad-platform conversions, and they
  are auto-deleted after a per-form retention (default 30 days).
- Analytics shows partial and complete counts separately.

---

## Phase 4 — GDPR data lifecycle

### OF-10 · Retention, bulk deletion & erasure API
**Repo:** OpenFlow · **Status:** missing (one-by-one delete only; delivery rows survive; backups keep deleted submissions for their retention) · **Effort:** M · **Depends on:** X-2, OF-4
**Why:** OpenFlow shouldn't become a second long-term lead store next to
lodgely, and a data-subject erasure has to reach it.

**Acceptance criteria**
- Per-form retention: delete submissions older than N days, or N days after
  lodgely acknowledged them (first successful v1 pull or webhook 2xx). A
  nightly job does the deleting and audit-logs the counts.
- Bulk delete on the Responses page, plus
  `POST /api/v1/erasure { emails, phones, submission_ids }` behind an
  `erase`-scoped token. It returns counts per form and any calon
  `booking_id`s left for manual cancellation.
- Deleting a submission also deletes its `integration_deliveries` rows and
  emits `submission.deleted`.
- `GET /api/v1/export?email=` returns every submission for a person (DSAR),
  admin session only.

### OF-11 · Encrypted backups
**Repo:** OpenFlow · **Status:** missing (plaintext JSON with every submission, IPs and password hashes) · **Effort:** S · **Depends on:** —
**Why:** a backup is a full PII copy that outlives deletions. lodgely
already offers passphrase encryption.

**Acceptance criteria**
- `BACKUP_PASSPHRASE` encrypts new scheduled and downloaded backups
  (AES-256-GCM, scrypt KDF). Restore asks for it.
- Unencrypted old backups keep restoring.
- The README states plainly what a backup contains and for how long deleted
  submissions survive in rotated backups.

---

## Phase 5 — Operator scale

### OF-12 · Team visibility for operators
**Repo:** OpenFlow · **Status:** missing (every query is scoped to the owning user, admins included) · **Effort:** M · **Depends on:** —
**Why:** in an agency (D4) a colleague's form is invisible to everyone else,
even to admins. Holidays and hand-overs break. Clients don't log into
OpenFlow, so this is about operator workspaces, not tenant isolation.

**Acceptance criteria**
- Admins can see and edit all forms. Forms can be shared with named users or
  a "team" (edit or view).
- Each form carries an optional `client` label. lodgely can pre-fill a
  source's client from it.
- API tokens still only see what their scope allows (OF-4).

### OF-14 · Form templates
**Repo:** OpenFlow · **Status:** missing (only "Duplicate a form") · **Effort:** S · **Depends on:** OF-1
**Why:** agencies rebuild the same funnels (callback request, quote, job
application, appointment) for every client. A starting point cuts setup to
minutes.

**Acceptance criteria**
- "New form from template" offers 4–6 built-in templates (DE/EN) with keys,
  routing and consent pre-configured.
- Any form can be saved as a custom template (integrations and secrets are
  never included).
- Templates are included in backup/restore.

### OF-15 · More respondent languages
**Repo:** OpenFlow · **Status:** partial (EN/DE) · **Effort:** S · **Depends on:** —
**Why:** only relevant for Swiss (FR/IT) clients or pan-European campaigns.
Skip it until one exists.

**Acceptance criteria**
- `locales.js` gains FR and IT with every respondent-facing string. The
  server validation messages follow the form language.
- A language picker appears per form. A missing key falls back to EN, with a
  unit test asserting key parity.

---

## Rejected / deferred

- **Lead scoring in OpenFlow — rejected.** Qualification lives only in
  lodgely (see the shared section). Routing on single answers (OF-5) covers
  the in-session need.
- **A/B testing — deferred.** SME forms rarely get enough traffic for a
  test to reach significance, and routing plus templates move conversion
  more. Revisit after OF-5, as variant split + analytics per variant.
- **Arbitrary custom domains — rejected.** Per-form subdomains under one
  wildcard cert already exist. A fully custom domain is a reverse-proxy
  concern (map it to `/f/<slug>`). The README gets a proxy recipe instead of
  in-app certificate management.
- **Horizontal scaling / shared rate-limit store — deferred.** Single
  instance is a deliberate choice (README "Single-instance architecture").
  OF-7 reduces the rate limiter's role in spam defence.

## Housekeeping (no phase)

- CLAUDE.md, README and editor copy drift found during the review was fixed
  in 0.41.0. Keep "Current Version", the README API list and the env table in
  sync with code in the same commit.
- The WordPress plugin settings page mentions only the shortcode and
  WPBakery, not the Gutenberg block (`openflow.php` "Usage" text).

---

## Shared: cross-repo interfaces & dependencies

> This section is **duplicated verbatim** in `vidual-labs/openflow/ROADMAP.md`
> and `vidual-labs/lodgely/ROADMAP.md`. Change it in both, in the same
> release pair.

### Who owns what

| Concern | Owner | Never in |
|---|---|---|
| Everything the visitor sees before or at submit: steps, validation, routing on individual answers (jump logic, conditional end screens, conditional redirects), consent capture, spam checks, calon booking at submit | **OpenFlow** | lodgely |
| Lead evaluation: scoring, qualification rules, labels, assignment to clients/owners, outreach state, reporting, ad-platform *quality* signals | **lodgely** | OpenFlow |
| Calendar availability + bookings | **calon** (external; known only through the interfaces below) | — |

**Rule of thumb.** A *single answer* deciding what the visitor sees next
(e.g. "budget < 5k → 'not a fit' end screen, no booking step") is **routing**
and lives in OpenFlow. A *combination of answers* producing a verdict about the
lead is **qualification** and lives only in lodgely. Qualification rules exist
in exactly one place.

**Current violations** (fixed by the items referenced):
- lodgely lets an OpenFlow field be mapped straight onto `status` / `priority`,
  so a form answer can set the evaluation → removed by **LG-5**.
- lodgely has two "qualified" notions (manual *Qualified* toggle, advisory AI
  qualification) → one qualification state owned by the rule engine in
  **LG-5**; AI stays advisory.
- The OpenFlow → lodgely interface is implicit and unversioned (no API
  version, offset-less timestamps, offset paging, webhook without submission
  id) → **X-1**.

### Decisions this roadmap builds on (confirmed 2026-10-06)

All five were confirmed on 2026-10-06 (OpenFlow 0.46.0 / lodgely 0.55.2).
Changing one is a roadmap change in both repos.

| # | Decision | Consequence |
|---|---|---|
| D1 | **No automatic feedback loop from lodgely into the session.** lodgely pulls/receives asynchronously, so its verdict can only drive *post-submit* actions (ad-platform conversions, notifications, operator actions). In-session gating (e.g. no booking for an obvious non-fit) is OpenFlow routing on single answers. | No lodgely → calon cancellation automation; cancelling a booking stays an operator action in calon. |
| D2 | **Push + pull.** A signed OpenFlow webhook delivers each submission to lodgely within seconds; the pull stays as hourly reconciliation (catches anything a push missed). | Webhook contract (X-1) and lodgely endpoint (LG-1) come first. |
| D3 | **Partial submissions only with explicit opt-in** at the contact step, short retention, imported by lodgely as `incomplete` and excluded from KPIs. | OF-8 depends on OF-9 (consent record). |
| D4 | **One OpenFlow + one lodgely per agency, many clients.** Clients log into lodgely only; OpenFlow stays operator-only. | OpenFlow needs team visibility (OF-12), not per-client tenancy; lodgely needs a real Client model (LG-4); full `tenant_id` multi-tenancy stays deferred. |
| D5 | **lodgely owns "qualified lead" conversions** to Google Ads / Meta. OpenFlow's own Google Ads / Meta CAPI integrations remain an optional "every lead" signal. | LG-7 depends on attribution travelling through the contract. |

### X-1 · OpenFlow submission contract v1

The one interface both repos build against. OpenFlow **produces** it (pull API
and webhook body are the same document); lodgely **consumes** it.

```jsonc
{
  "schema_version": 1,
  "event": "submission.created",        // | submission.partial | submission.completed | submission.deleted
  "submission_id": "uuid-v4",           // stable forever; the idempotency key
  "form": { "id": "uuid", "slug": "spring-launch", "title": "…", "revision": 12 },
  "submitted_at": "2026-09-29T10:00:00Z", // ISO 8601, always UTC with Z
  "status": "complete",                 // | partial
  "fields": [ { "key": "email", "id": "field_1727…", "type": "email", "label": "Your email" } ],
  "answers": { "email": "jane@example.com", "budget": "10–25k" }, // keyed by field *key*
  "attribution": {
    "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "…", "utm_term": "…", "utm_content": "…",
    "gclid": "…", "gbraid": null, "wbraid": null, "fbc": "…", "fbp": "…",
    "landing_url": "https://…", "referrer": "https://…",
    "hidden": { "partner_id": "42" }   // operator-declared hidden fields
  },
  "consent": { "given": true, "text_hash": "sha256:…", "given_at": "2026-09-29T09:59:58Z" },
  "bookings": { "appointment": { "status": "booked", "booking_id": "…", "start": "2026-10-02T09:30:00+02:00" } },
  "files": [ { "field_key": "cv", "name": "cv.pdf", "size": 183422, "type": "application/pdf" } ]
}
```

- **IDs.** `submission_id` (UUID v4) is the only idempotency key.
  `form.id` never changes. Field **keys** are stable, human-readable and
  unique within a form (OF-1); the opaque field `id` is kept for back-compat
  only. lodgely maps by key and falls back to id.
- **Time.** Every timestamp is ISO 8601 UTC with `Z`. (Today OpenFlow emits
  offset-less SQLite strings. lodgely 0.55.0 parses them as UTC, which is the
  interim fix.)
- **Minimisation.** No IP, no user agent, no file contents in the contract.
  Files are listed as metadata only. IP/user agent stay in OpenFlow for the
  ad-platform integrations that need them.
- **Pull.** `GET /api/v1/forms/:id/submissions?cursor=<opaque>&limit=100`
  returns `{ schema_version, submissions: [...], next_cursor }`, ascending by
  `(submitted_at, submission_id)`. The cursor makes the walk resumable and
  gap-free (replaces today's newest-first offset paging with a 1-second tie
  problem).
- **Push.** `POST <lodgely endpoint>` with the same document.
  - Headers: `X-OpenFlow-Event`, `X-OpenFlow-Delivery` (uuid) and
    `X-OpenFlow-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
  - Receivers reject signatures older than 5 minutes.
  - Delivery uses OpenFlow's existing retrying delivery queue.
- **Tokens.** Pull tokens are read-only and **scoped to named forms**
  (OF-4). Erasure uses a separate `erase` scope (X-2).
- **Versioning.**
  - Additive changes stay within v1. Consumers must ignore unknown keys.
  - A breaking change ships as v2, and v1 keeps being served for at least two
    OpenFlow minor releases.
  - `GET /api/v1/meta` returns `{ api_versions: [1], app_version }`, so
    lodgely can refuse an incompatible install with a clear message.
  - The legacy unversioned `/api/forms` and `/api/submissions` stay until
    lodgely no longer uses them.
- **Timing.**
  - Push: under 1 minute after submit (retries: 1/5/30/120 min).
  - Pull: hourly reconciliation.
  - A calon booking is already final in the payload (booked before storage;
    `pending` is resolved by OpenFlow's retry sweep and re-emitted as
    `submission.completed`).

### X-2 · Cross-system erasure & export (GDPR)

- A data-subject request is started **in lodgely** (the system the operator
  works in). lodgely finds every lead matching the person (normalized email /
  phone). It then:
  - exports or erases them locally;
  - calls OpenFlow `POST /api/v1/erasure` with a token scoped `erase` (by
    submission ids plus email/phone), receiving counts per form;
  - records one audit entry with both results.
- OpenFlow's side:
  - deletes submissions, delivery rows and backups' future copies;
  - emits `submission.deleted` for each, so any other consumer can follow;
  - cannot delete a calon booking. The erasure report lists `booking_id`s
    for the operator to cancel in calon.
- Retention runs independently in each system. OpenFlow can be set to delete
  a submission N days after lodgely has acknowledged it (OF-10), so the form
  builder isn't a second long-term lead store.

### Dependency map

```
X-1 contract ─┬─> OF-1 field keys ─┬─> OF-2 v1 pull API ──> LG-2 consume v1 (pull)
              │                    ├─> OF-3 signed webhook ─> LG-1 push endpoint
              │                    └─> OF-5 routing (conditions reference keys)
              ├─> OF-4 scoped tokens
              └─> OF-6 hidden fields/UTM ──> LG-6 attribution ──> LG-7 quality conversions
OF-9 consent record ──> OF-8 partials ──> LG-8 partial leads
LG-4 Client model ──> LG-5 qualification rules ──> LG-7, LG-10 notifications
X-2 erasure ──> OF-10 retention/erasure API + LG-12 DSAR
```

| Item | Repo | Blocks |
|---|---|---|
| X-1 contract v1 | both (spec) | OF-2, OF-3, OF-6, LG-1, LG-2, LG-6 |
| OF-1 stable field keys | OpenFlow | OF-2, OF-5, LG-2, LG-5 |
| OF-3 signed webhook v1 | OpenFlow | LG-1 |
| OF-6 hidden fields & UTM | OpenFlow | LG-6, LG-7 |
| OF-8 partial submissions | OpenFlow | LG-8 |
| OF-10 retention & erasure API | OpenFlow | LG-12 |
| LG-4 Client model | lodgely | LG-5, LG-9 |
| LG-5 qualification rules | lodgely | LG-7, LG-10 |
