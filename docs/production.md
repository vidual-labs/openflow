<sub>[← README](../README.md) · [All docs](README.md)</sub>

# Security & production notes

For reporting a vulnerability, see [SECURITY.md](../SECURITY.md).

## TLS

The base `docker-compose.yml` serves plain HTTP on `:3000` — it does not
terminate TLS itself. Put a reverse proxy in front in production:
- Use the bundled [Custom Subdomains](subdomains.md) Caddy overlay
  (`docker-compose.subdomains.yml`) if you want per-form subdomains, which
  gets you TLS for free.
- Otherwise, put OpenFlow behind any reverse proxy you already run (Caddy,
  Nginx, Traefik, a managed load balancer) and terminate TLS there. This is
  a deliberate deployment-layer decision, not something the app does for
  you — most self-hosters already have a reverse proxy in front of every
  service on their box.

## Reverse proxy & client IPs

Behind any reverse proxy, set `TRUST_PROXY=1` (or the number of proxies in
front). Without it, Express sees every request as coming from the proxy: all
visitors share **one** rate-limit bucket (10 submissions per minute for the
whole install, so real leads get a 429 during a campaign spike), and the
proxy's address is stored as the submitter IP and sent to Meta's Conversions
API. OpenFlow logs `trust_proxy_not_configured` once when it sees an
`X-Forwarded-For` header without `TRUST_PROXY`. The subdomain overlay implies
it via `OPENFLOW_PRIMARY_HOST`. Don't set it when OpenFlow is reachable
directly — any client could then pick its own IP.

## Secure defaults

- No password or secret ships with OpenFlow. `ENCRYPTION_KEY` is generated
  on first boot when unset; the first admin gets a random one-time password
  printed to the log. A weak `ADMIN_PASSWORD` (< 10 characters, a well-known
  default or an easily guessed pattern like `Password2026!`) makes the first
  boot refuse to create the admin.
- Login sessions are stored server-side (only a hash of the cookie's token),
  last 7 days, and end immediately on logout, password change, role change or
  an admin's "log out everywhere". `JWT_SECRET` is no longer used since 0.44
  and can be removed.
- Failed logins lock the account for 1, 5, 15, then 60 minutes after every 5
  failures (persisted, so a restart doesn't reset it, and identical for
  unknown e-mails). Browsers that signed in to the account before are not
  locked out, so an attacker can't lock the owner out of their usual browser.
  The owner is e-mailed once the attempts pile up.
- **Two-factor login (opt-in, per user, Account page):** signing in from a new
  browser also needs a 6-digit code sent by e-mail (valid 10 minutes, 5
  tries, at most 5 codes per 15 minutes). Ticking "remember this browser"
  skips the code there for 30 days. Needs system e-mail (Settings → System
  e-mail, or `SMTP_*`). An admin can switch it off
  for a user who lost their mailbox; `OPENFLOW_2FA_DISABLED=true` is the
  server-wide emergency switch. Integrations such as lodgely should use an API
  token, which keeps working with two-factor login on.
- Every user can change their own password (Account page), see their active
  sessions and remembered browsers, and sign out everywhere else.
- Admin pages are served with a strict Content-Security-Policy (only
  OpenFlow's own scripts), `X-Frame-Options: DENY`, `nosniff` and HSTS over
  HTTPS. Public form pages (`/f/`, `/embed/`, form subdomains) keep working
  with GTM, Meta Pixel and iframes.
- Accounts that still use a well-known default password (e.g. `admin123`
  from an install older than 0.16) are logged as
  `default_admin_password_in_use` at boot, and the user sees a red "change
  your password" banner in the admin UI until they do.
- API tokens are read-only and never pass an admin check, even when an admin
  created them.

## Tracking scripts and your admin session

Form pages (`/f/`, `/embed/`) are served from the same address as the admin
app, so a form's Google Tag Manager container — third-party script — would
run with the session of anyone signed in to OpenFlow who opens the form.
Since 0.49 OpenFlow limits that in three ways:

- **No GTM for signed-in browsers.** When the request for a form carries a
  valid OpenFlow session cookie, the API leaves the container out and the
  form shows a small "Google Tag Manager is off because you're signed in"
  notice. Visitors are not affected. The response is
  `Cache-Control: private, no-store` with `Vary: Cookie`, so no cache in
  between can hand one version to the other. **Test tracking in a private
  window** (or another browser profile).
- **Only admins set or change a form's container.** Other users see the
  field read-only and can remove a container, but not add or change one.
  Containers already on their forms keep working, and duplicating a form
  keeps its container.
- **Sensitive actions ask for the password again ("sudo mode").**
  Downloading or restoring a backup (including a scheduled one), creating,
  changing, signing out or deleting users and creating API tokens ask for
  the password once, then work for 10 minutes — in that session only. A
  fresh login doesn't count, wrong passwords count toward the account
  lockout, and two-factor accounts confirm with the password alone. Reading
  forms and submissions (what lodgely does) is not affected.

Per-form subdomains never receive the session cookie (it is host-only) and
have no admin API, so GTM there runs as before.

**What this does not cover.** A form page that loaded its container while
you were signed out keeps that script running. If you then sign in, in
another tab of the same browser, the script can make requests with your
new session: read what your account can read (your forms and submissions;
for an admin also the user list and the audit log) and use what isn't
behind the password check, such as editing forms and their integrations.
The same goes for an `/embed/` frame on another site, whose script could
open OpenFlow in a new window. Backups, users and new API tokens stay out
of its reach unless you confirmed your password in the last 10 minutes.
So: open forms that have GTM, and test tracking, in a private window, and
close form tabs before signing in. The complete fix — serving the admin
app from its own hostname — is not part of OpenFlow yet.

## Single-instance architecture

OpenFlow's rate limiter (`models/rateLimit.js`) and scheduled-backup job
(`models/backupScheduler.js`) are in-process and in-memory by design — this
keeps the app a genuinely zero-dependency, single SQLite file deployment
with nothing else to run (no Redis, no external queue). This is an accepted
tradeoff, not a bug: run **one** container per OpenFlow instance. Running
multiple replicas behind a load balancer will not share rate-limit state
between them (each replica enforces its own limits independently) and will
write duplicate scheduled backups. Horizontal scaling would need a shared
store for both and is not currently supported.

## Backups: what's automatic vs. manual

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

## Deferred for now

The following are known gaps, deliberately not addressed yet:
- **App-based two-factor login (TOTP) and admin-enforced 2FA** — two-factor
  login is opt-in per user and uses e-mailed codes.
- **Admin UI localization** — only respondent-facing form strings ship in
  EN/DE (`frontend/src/locales.js`); the admin interface itself is
  English-only.
- **Automated data-retention / GDPR erasure workflows** — submissions can be
  deleted one at a time or exported as CSV, but there's no policy-driven
  auto-expiry or bulk "erase everything for this data subject" tool yet.
