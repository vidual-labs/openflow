<sub>[← README](../README.md) · [All docs](README.md)</sub>

# Installation & configuration

## Install

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

## ⚙️ Environment variables

Environment variables (in `.env` or docker-compose):

| Variable | Default | Description |
|----------|---------|-------------|
| `ENCRYPTION_KEY` | *(none — auto-generated)* | 🔐 64 hex chars (32 bytes). Encrypts integration secrets (SMTP passwords, Google credentials, webhook HMAC secrets) at rest. If unset, a random key is generated and persisted next to the database — set this explicitly in production **and back it up separately from the database**, since losing it makes existing encrypted integration config unrecoverable. Setting it on an install that ran on an auto-generated key is safe: the old key file is still used to read existing secrets. Backups contain secrets encrypted with this key, so restoring on another instance needs the same key |
| `CALON_ALLOWED_HOSTS` | *(unset)* | 📅 Comma-separated `host[:port]` entries (e.g. `calon:8000,localhost:8000`) a [calon](integrations/calon.md) base URL may point at although they are localhost or on a private network — for a calon instance next to OpenFlow (same Docker network or LAN). Applies only to OpenFlow's two calon requests (availability and booking), never to webhooks or other integrations; an entry without a port allows any port on that host; link-local / cloud-metadata addresses stay refused even when listed. Unset, a calon URL must resolve to a public address |
| `SMTP_BLOCK_PRIVATE_HOSTS` | *(unset)* | 📧 SMTP hosts resolving to link-local/cloud-metadata addresses are always refused. Set to `true` to also refuse private networks and localhost (as webhooks do) when you don't relay mail through an internal server |
| `SMTP_HOST` | *(unset)* | ✉️ OpenFlow's own outgoing mail: two-factor login codes and security notices (new sign-in, password changed, repeated failed logins). Optional: admins can instead enter it under **Settings → System e-mail** (stored encrypted). When set here, the `SMTP_*` values win and the UI shows them read-only. Check it with **Send test e-mail** there |
| `SMTP_PORT` | `587` | ✉️ SMTP port (`465` implies `SMTP_SECURE=true`) |
| `SMTP_SECURE` | `true` on port 465, else `false` | ✉️ `true` = implicit TLS; otherwise STARTTLS |
| `SMTP_REQUIRE_TLS` | `true` | ✉️ Refuse to send codes over an unencrypted connection. Set `false` only for a relay on a trusted local network |
| `SMTP_USER` / `SMTP_PASS` | *(unset)* | ✉️ SMTP credentials |
| `SMTP_FROM` | `SMTP_USER` if it is an address | ✉️ Sender, e.g. `OpenFlow <no-reply@example.com>` (required when `SMTP_USER` isn't an address) |
| `OPENFLOW_2FA_DISABLED` | *(unset)* | 🚨 Emergency switch: accounts with two-factor login sign in with their password only (e.g. while SMTP is broken). Logged as a warning at every boot; remove it again afterwards |
| `BCRYPT_ROUNDS` | `12` | 🔑 bcrypt cost for password hashes (10–14). Lower it only on very slow hardware; older hashes are upgraded on the next login |
| `ADMIN_EMAIL` | `admin@openflow.local` | 👤 Admin email |
| `ADMIN_PASSWORD` | *(none — auto-generated)* | 🔑 Admin password (only on first start). If unset, a random one is generated and printed to the log once |
| `DB_PATH` | `/app/data/openflow.db` (from `docker-compose.yml`; otherwise `backend/data/openflow.db`) | 💾 SQLite database path |
| `PORT` | `3000` | 🌐 Port the app listens on *inside* the container |
| `HOST_PORT` | `3000` | 🌐 Host-side port `docker-compose.yml` publishes (set this instead of editing `docker-compose.yml` directly, so `git pull` never conflicts with a local port change) |
| `CORS_ORIGINS` | *(empty)* | 🌍 Comma-separated extra origins allowed to call the API. Same-origin requests are always allowed, so this is only needed when the admin UI is served from a different host than the API |
| `OPENFLOW_PRIMARY_HOST` | *(empty)* | 🌐 Apex host for [custom subdomains](subdomains.md). Also implicitly allowed as a CORS origin, and implies `TRUST_PROXY=1` |
| `TRUST_PROXY` | *(empty = off)* | 🔀 Set when OpenFlow runs behind a reverse proxy: a hop count (`1` = one proxy in front), `true`, or a comma-separated list of proxy IPs/CIDRs. Without it every visitor shares the proxy's IP — one rate-limit bucket for everybody and the proxy's address stored as the submitter IP |
| `OPENFLOW_LANDING_PAGE` | *(unset = off)* | 🏠 Set to `true` to show the OpenFlow landing page (features, self-host guide) at `/` to logged-out visitors; the login then lives at `/login`. Off, `/` opens straight on the login screen as before |
| `OPENFLOW_VERSION` | `latest` | 🐳 Image tag `docker-compose.yml` pulls (e.g. `0.31.0` to pin a version instead of always tracking `latest`) |
| `BACKUP_ENABLED` | `true` | ⏰ Set to `false` to disable the scheduled backup job |
| `BACKUP_DIR` | `/app/backups` (from `docker-compose.yml`; otherwise a `backups/` folder next to `DB_PATH`) | 📁 Where scheduled backups are written (point at a separate volume for real off-box protection) |
| `BACKUP_INTERVAL_HOURS` | `24` | ⏱️ How often to write a scheduled backup |
| `BACKUP_RETENTION_COUNT` | `14` | 🗑️ How many scheduled backups to keep before pruning the oldest |

> 💾 `docker-compose.yml` bind-mounts `./backups` on the host into the container, deliberately **outside** the `db-data` volume — so wiping or losing that volume doesn't take the backups with it. Copy `./backups` off the host regularly for real disaster recovery.
