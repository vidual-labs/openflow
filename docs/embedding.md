<sub>[← README](../README.md) · [All docs](README.md)</sub>

# Embedding & tracking

## Simple iFrame

```html
<iframe
  src="https://your-domain.com/embed/FORM_SLUG"
  width="100%" height="600"
  frameborder="0"
  style="border:none;border-radius:12px;">
</iframe>
```

## iFrame with Auto-Resize

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

After a successful submission the iframe also posts
`{ type: 'openflow-submit', formId, eventId }` to the page, e.g. to fire a
Meta Pixel `Lead` with `eventID: e.data.eventId` (see
[`integrations/meta-conversion-api.md`](integrations/meta-conversion-api.md)).

## WordPress

1. Upload `wordpress-plugin/openflow/` to `/wp-content/plugins/`
2. Activate the plugin
3. Go to **Settings → OpenFlow** and enter your server URL
4. Use anywhere:

```
[openflow slug="your-form-slug" height="600" autoresize="true"]
```

Also available as a **WPBakery element** and **Gutenberg block**.

## Custom URL Slug

Every form is reachable at `/f/<slug>`. Open the form's **Embed** tab to rename the slug from the auto-generated 8-character code to anything memorable (e.g. `/f/spring-launch`). Rules:

- Lowercase letters, digits, hyphens. 3–60 characters.
- No leading/trailing or consecutive hyphens.
- Reserved labels (`admin`, `api`, `login`, `embed`, `f`, `dashboard`, …) are rejected.
- Must be unique across all forms.

Previously shared URLs keep working: when you change a slug, the old one is recorded in a history table and visits to it transparently load the form at its current slug. The browser URL bar is updated to the canonical address so subsequent shares use the new URL.

## Custom Subdomains

Each form can also live on its own subdomain (`acme.forms.example.com`) — see **[subdomains.md](subdomains.md)**.

## 🏷️ GTM Events

OpenFlow automatically pushes events to the Google Tag Manager dataLayer:

| Event | Trigger | Data |
|-------|---------|------|
| `openflow_step` | Each step change | `formId`, `stepIndex`, `stepId` |
| `openflow_submit` | Form submitted | `formId`, `formTitle`, `eventId` (the submission id, for Meta Pixel deduplication) |

Set the container ID per form under **GTM / GDPR → GTM Container ID** (it must look like `GTM-XXXXXXX`). Only **admins** can set or change it; other users see it read-only and can only remove it.

Browsers signed in to OpenFlow never load a form's GTM container — the form shows a small notice instead — because the container is third-party script running on OpenFlow's own address. **Test tracking in a private window.** See [Tracking scripts and your admin session](production.md#tracking-scripts-and-your-admin-session).

### 🍪 Cookie consent banner

Optionally, a consent banner can be shown **before** the GTM container is loaded — GTM only fires once the visitor accepts, and the choice is remembered in their browser so the banner doesn't reappear. Enable it under **GTM / GDPR → Cookie / Tracking Consent Banner**; the message and both button labels are editable. A GTM container ID must be set first.

The same consent gates the ad click IDs that the [Google Ads](integrations/README.md#-google-ads-server-side-conversion) (`gclid`/`gbraid`/`wbraid`) and [Meta Conversions API](integrations/README.md#-meta-conversions-api) (`fbclid`, `_fbp`/`_fbc` cookies) integrations rely on.
