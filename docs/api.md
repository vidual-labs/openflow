<sub>[← README](../README.md) · [All docs](README.md)</sub>

# API endpoints

All routes live under `/api`. Admin routes accept the session cookie, a `Bearer` session token, or a read-only `ofw_` API token (GET/HEAD only).

## Public (no auth)
- `GET /api/health` — Liveness/readiness check (database connectivity + uptime), for orchestrators and uptime monitors
- `GET /api/public/form/:slug` — Load published form. A request with a valid OpenFlow session cookie gets `gtm_id: ""` and `gtmSuppressed: true` instead of the form's GTM container; always `Cache-Control: private, no-store` + `Vary: Cookie`
- `GET /api/public/form/:slug/availability` — Bookable times for a calon-backed Date & Timeslot field (proxied, SSRF-guarded)
- `POST /api/public/form/:slug/submit` — Submit response (`400 consent_required` when the form asks for consent and it wasn't given)
- `POST /api/public/track` — Track analytics event

## Auth
- `POST /api/auth/login` — Log in (sets the session as a `token` httpOnly cookie; the body is `{ user }`). For an account with two-factor login on, from a browser it doesn't remember, the body is `{ twoFactorRequired: true, challenge, email }` instead and a code is e-mailed. `429` with `code: "account_locked"` and `Retry-After` while the account is locked
- `POST /api/auth/login/verify` — `{ challenge, code, remember }` → `{ user }` + session cookie
- `POST /api/auth/logout` — End the session (server-side) and clear the cookie
- `GET /api/auth/me` — Current user (includes `twoFactorEnabled`)
- `GET /api/auth/account` — Own two-factor status, active sessions and remembered browsers
- `POST /api/auth/password` — Change own password (`currentPassword`, `newPassword`); signs out every other session
- `POST /api/auth/2fa/start` / `POST /api/auth/2fa/confirm` / `POST /api/auth/2fa/disable` — Turn two-factor login on (password → e-mailed code) or off (password)
- `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-others`, `DELETE /api/auth/devices/:id` — End a session, sign out everywhere else, forget a remembered browser
- `POST /api/auth/confirm-password` — `{ password }` → `{ ok, validUntil }`: "sudo mode" for the routes marked 🔐 below, for 10 minutes on this session only (session only, never an API token). `401 wrong_password` counts toward the account lockout; `429 account_locked` while it is locked

> 🔐 marks routes that answer `403` with `code: "reauth_required"` unless the password was confirmed on this session in the last 10 minutes. A fresh login does not count.

## Admin (auth required)
- `GET /api/forms` — List your forms (every form query is scoped to its owner)
- `GET /api/forms/:id` — Get one form (including its `steps`)
- `POST /api/forms` — Create form (`403 gtm_admin_only` when a non-admin sends a `gtm_id`)
- `POST /api/forms/:id/clone` — Duplicate a form (draft copy, integrations disabled)
- `PUT /api/forms/:id` — Update form (`403 gtm_admin_only` when a non-admin changes `gtm_id`; sending the stored value or `""` is fine)
- `DELETE /api/forms/:id` — Delete form
- `POST /api/forms/:id/calon-test` — Check a calon base URL + resource from the editor
- `GET /api/submissions/:formId` — Get submissions (paginated, newest first)
- `GET /api/submissions/:formId/export` — CSV export
- `DELETE /api/submissions/:formId/:submissionId` — Delete a submission
- `GET /api/settings` — Read global settings (public) — branding and the configured primary host
- `PUT /api/settings/:key` — Update a global setting (admin only)

## Integrations (auth required)
- `GET /api/integrations/:formId` — List integrations (secret fields are never returned; `secrets` says which are set)
- `POST /api/integrations/:formId` — Create integration
- `PUT /api/integrations/:formId/:id` — Update integration (an omitted secret field keeps its stored value, `null`/`""` clears it)
- `DELETE /api/integrations/:formId/:id` — Delete integration
- `POST /api/integrations/:formId/:id/test` — Test integration
- `GET /api/integrations/:formId/deliveries` — List delivery attempts (retrying/failed/dead)
- `POST /api/integrations/:formId/deliveries/:deliveryId/retry` — Manually retry a delivery

## Analytics (auth required)
- `GET /api/analytics/overview` — Overview stats for all forms
- `GET /api/analytics/:formId` — Detailed analytics for a form

## User Management (admin only)
- `GET /api/auth/users` — List all users
- 🔐 `POST /api/auth/users` — Create/invite user
- 🔐 `PUT /api/auth/users/:id` — Update user role/password (either one immediately revokes that user's existing sessions) or reset their two-factor login
- 🔐 `DELETE /api/auth/users/:id` — Delete user
- 🔐 `POST /api/auth/users/:id/revoke-sessions` — Force-expire a user's existing sessions without changing their password ("Log out everywhere")

## API Tokens (session auth only — a token can never manage tokens)
- `GET /api/auth/tokens` — List your tokens (prefix + last used, never the secret)
- 🔐 `POST /api/auth/tokens` — Mint a token (the plaintext `ofw_…` value is returned **once**)
- `DELETE /api/auth/tokens/:id` — Revoke a token

## Backup & Restore (admin only)
- `GET /api/admin/backup/info` — Summary of current DB contents and backup format version
- 🔐 `GET /api/admin/backup` — Download a full JSON backup
- 🔐 `POST /api/admin/restore` — Restore from a JSON backup
- `GET /api/admin/backups` — List backups written by the scheduler
- 🔐 `GET /api/admin/backups/:filename` — Download a specific scheduled backup
- `GET /api/admin/mail` — System e-mail settings (`source`: `env` | `ui`, `locked` when `SMTP_*` is set; the password is never returned, only `passwordSet`)
- `PUT /api/admin/mail` — Save SMTP settings after checking the connection (`422 verify_failed` otherwise; `skipVerify: true` saves anyway; an omitted `password` keeps the stored one, `""` clears it). `409` while `SMTP_*` manages it
- `DELETE /api/admin/mail` — Remove the UI SMTP settings
- `POST /api/admin/mail/test` — Send a test message to yourself

## Audit Log (admin only)
- `GET /api/admin/audit-log?limit=200` — Recent security-relevant events (logins, user/role changes, settings changes, backup/restore), newest first. Not included in backups — it's a trail of what happened to the instance, not instance data to restore.

> 🔑 Read-only API tokens (`Authorization: Bearer ofw_…`) may call any **GET/HEAD** endpoint above on behalf of their owner. Every other method is rejected.
