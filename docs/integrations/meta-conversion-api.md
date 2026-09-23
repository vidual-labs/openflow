# Meta Conversions API Setup

This integration sends a server-side `Lead` event to Meta's
[Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api)
(Graph API `/{pixel_id}/events`) on every form submission. No Meta Pixel
needs to be installed on the form — matching relies on the submission's
captured IP address and user agent, SHA-256-hashed `Email`/`Phone`
field values when the form collects them, and the ad click ID (`fbclid`)
when the visitor came from a Meta ad.

This is a one-time setup you do outside OpenFlow, in Meta's Events Manager.
OpenFlow itself only stores the resulting Pixel ID and access token (pasted
into the integration config).

## 1. Create or find a Pixel

1. Go to [Events Manager](https://business.facebook.com/events_manager2) and
   select (or create) a Pixel under **Data Sources**.
2. Note the **Pixel ID**, shown at the top of the Pixel's overview page.

## 2. Generate an access token

1. In the Pixel's **Settings** tab, scroll to **Conversions API**.
2. Under "Set up manually", click **Generate access token**.
3. Copy the token — Meta only shows it once. Treat it like a password; it
   grants permission to send events to this Pixel.

## 3. Configure the integration in OpenFlow

In the form's **Integrations** tab, add a **Meta Conversions API**
integration and fill in:

| Field | Value |
|-------|-------|
| Pixel ID | From step 1 |
| Access Token | From step 2 |
| Test Event Code | Optional — see below |
| Currency | e.g. `USD` |
| Default Value / Value Field | A fixed event value, or map one of the form's numeric fields |

## 4. Test without polluting real ad data

Under Events Manager → the Pixel → **Test Events**, copy the test event
code shown there and paste it into the integration's **Test Event Code**
field while you're testing. With one set, the **Test** button sends a real
event that shows up under Test Events instead of being counted as a real
lead. Remove the test event code before going live — with none set, the
**Test** button only validates the Pixel ID/access token (a GET request),
since a synthetic test submission has no genuine lead and would otherwise
post a fake Lead event straight into your ad account's real conversion
counts.

## How it works

- `user_data` is built from the submission's IP address and user agent
  (already captured for every submission) plus any `Email`/`Phone` field's
  value, hashed with SHA-256 as Meta requires — matched by the field's
  **type**, not its id, so it works without any extra configuration.
- When the visitor arrived from a Meta ad (`?fbclid=` in the form's URL),
  the click ID is sent as `fbc`, in the format of the Pixel's `_fbc` cookie.
  If a Meta Pixel on the form page (e.g. loaded through GTM) has set the
  `_fbp` / `_fbc` cookies, those are sent too. Like Google Ads click IDs,
  this is captured only once cookie consent allows it; without consent the
  event is still sent, matched on IP, user agent and hashed email/phone.
- Every event carries `event_id` = the submission's id, so a delivery the
  retry queue sends again is counted once — see *Deduplication* below.
- Deliveries happen asynchronously after the submission is stored, with the
  same retry/dead-letter handling as OpenFlow's other integrations; a
  failed delivery can be inspected and manually retried from the
  Integrations tab.

## Click IDs in embedded forms

An embedded form runs in an iframe, which can't see the embedding page's
URL — so an `fbclid` on the page hosting the iframe does not reach
OpenFlow (the same holds for Google Ads' `gclid`). Click IDs are captured
when visitors land on the form's direct link (`/f/<slug>` or its
subdomain), or when the `fbclid` is part of the iframe's own `src`.

## Deduplication with a Meta Pixel

You don't need a Meta Pixel, but if you also run one and fire a `Lead`
from it, pass the submission id as the Pixel's `eventID` — Meta then merges
the browser and server events into one lead instead of counting two. The
id is available in two places after a successful submission:

- **GTM on the form page:** the `openflow_submit` dataLayer event carries
  `eventId`. In GTM, read it with a Data Layer Variable (`eventId`) and use
  it as the Event ID of your Meta Pixel `Lead` tag.
- **The page embedding the form:** the iframe posts
  `{ type: 'openflow-submit', formId, eventId }` to its parent window:

  ```html
  <script>
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'openflow-submit' && window.fbq) {
      fbq('track', 'Lead', {}, { eventID: e.data.eventId });
    }
  });
  </script>
  ```

  Check `e.origin` against your OpenFlow host if other iframes on the page
  post messages.
