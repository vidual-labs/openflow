<sub>[← README](../README.md) · [All docs](README.md)</sub>

# Custom subdomains

Serve each form on its own subdomain of a host you control (e.g. `acme.forms.example.com`). Every form gets a vanity URL that's friendlier than `/f/<slug>` and looks tenant-owned. A form keeps its existing `/f/<slug>` and `/embed/<slug>` paths in parallel — the subdomain is just an additional, prettier entry point.

## How it works

Caddy fronts the app on ports 80/443 and acquires **one wildcard TLS certificate** for `*.<primary-host>` via Let's Encrypt's DNS-01 challenge. That single cert covers every form on every subdomain — there is no per-tenant verification step or on-demand TLS dance. When a request lands on `<sub>.<primary-host>`, the backend looks up which form claimed that subdomain, blocks any admin API paths with a 404, and injects the form's identity into `index.html`. The frontend then boots in form-only mode: every URL renders that form and admin routes are unreachable.

## 1. Operator setup (one-time)

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

## 2. Per-form usage

For each form you want on its own subdomain:

1. Open the form in the editor and go to the **Embed** tab.
2. In **Custom subdomain (optional)**, type a label — `acme`, `widgets-inc`, `summer-promo` — and click **Update**.
   - Rules: 3–60 chars, lowercase letters, digits and hyphens only. No leading/trailing or consecutive hyphens. Common reserved labels (`www`, `api`, `admin`, `mail`, etc.) are rejected.
3. **Publish** the form (it must be live to be served on the subdomain).
4. The success message links to the live URL: `https://<label>.<your-primary-host>`.

To change the subdomain later, just edit the field and click **Update** — the form is reachable at the new label immediately. To detach the subdomain entirely, clear the field and click **Update** (or use the **Remove** button when the value matches what's saved). Note that — unlike the editable slug — subdomain changes are **not** archived: the old subdomain stops working immediately. Use it for stable tenant-style URLs, not for marketing campaign renames.

A form's `/f/<slug>` and `/embed/<slug>` URLs on the primary host always keep working in parallel.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Caddy logs show `no DNS module registered with name "cloudflare"` (or similar) | The Caddy image doesn't include the DNS plugin. Use a community image or build with `xcaddy`. |
| Cert issuance hangs or times out | DNS API token lacks edit rights for the zone, or the wildcard record isn't visible yet. Verify with `dig`. |
| `acme: error: 429 :: urn:ietf:params:acme:error:rateLimited` | You hit Let's Encrypt's rate limit during testing. Caddy's data volume persists certs across restarts — don't `docker compose down -v` between attempts. |
| Subdomain returns the admin UI instead of the form | The form isn't published, or its `subdomain` field doesn't match the label. Confirm via `GET /api/forms/:id` on the admin host. |
| Visiting the subdomain shows "Form not found" | The subdomain is unclaimed, or the form was deleted/unpublished. |
| Admin works on `https://forms.example.com` but `https://forms.example.com:3000` is also reachable | You didn't use the overlay file — the base compose still publishes port 3000. Use both `-f` flags in `docker compose up`. |
