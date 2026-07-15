# Google Ads (Server-Side Conversion) Setup

This integration uploads qualifying leads as offline conversions to Google
Ads via Google's [Data Manager API](https://developers.google.com/data-manager/api),
using the `gclid`/`gbraid`/`wbraid` click ID captured from the form's landing
URL. It does not require a Google Ads developer token — only a standard
OAuth2 client and a refresh token for a Google account with access to the
target Google Ads account.

This is a one-time setup you do outside OpenFlow, in the Google Cloud
Console and Google Ads UI. OpenFlow itself only stores the resulting
credentials (pasted into the integration config) — it does not perform an
OAuth consent flow on your behalf.

## 1. Create a Google Cloud project and OAuth client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or reuse) a project.
2. Under **APIs & Services → Library**, enable the **Data Manager API**.
3. Under **APIs & Services → Credentials**, create an **OAuth client ID**.
   Choose **Desktop app** as the application type — this avoids needing a
   public redirect URI, and is sufficient for the one-time token exchange
   below.
4. Note the **Client ID** and **Client Secret**.

## 2. Generate a refresh token

Using the OAuth client from step 1, run through a one-time OAuth consent
flow to obtain a refresh token for a Google account that has access to your
Google Ads account. Two common ways to do this:

- **Google OAuth 2.0 Playground** (https://developers.google.com/oauthplayground):
  in the gear icon settings, check "Use your own OAuth credentials" and
  paste in your client ID/secret, then authorize scope
  `https://www.googleapis.com/auth/datamanager` and exchange the
  authorization code for tokens. Copy the **refresh token** from the result.
- A small local script using any OAuth2 library (e.g. Google's official
  client libraries) performing the standard installed-app authorization
  code flow with the same scope.

Keep this refresh token secret — it's a long-lived credential.

## 3. Find your Google Ads customer ID and conversion action ID

1. **Customer ID**: shown in the top-right of the Google Ads UI when signed
   into the target account, formatted like `123-456-7890`. If the account
   sits under a manager (MCC) account, also note the manager account's
   customer ID — you'll enter that as the optional "Login Customer ID".
2. **Conversion Action ID**: in Google Ads, go to **Goals → Conversions**,
   open (or create) a conversion action of type "Import" / click-based
   upload, and note its ID (visible in the URL or via the Google Ads API/UI
   details for that conversion action).

## 4. Configure the integration in OpenFlow

In the form's **Integrations** tab, add a **Google Ads (Server-Side
Conversion)** integration and fill in:

| Field | Value |
|-------|-------|
| OAuth Client ID | From step 1 |
| OAuth Client Secret | From step 1 |
| Refresh Token | From step 2 |
| Customer ID | From step 3 |
| Login Customer ID | Only if under a manager/MCC account |
| Conversion Action ID | From step 3 |
| Currency | e.g. `USD` |
| Default Value / Value Field | A fixed conversion value, or map one of the form's numeric fields |

Click **Test** to verify the credentials (this does not upload a real
conversion — a test submission has no genuine click ID).

## How it works

- OpenFlow captures `gclid`/`gbraid`/`wbraid` from the form's URL query
  string when the visitor lands on it, subject to the same cookie-consent
  setting already used for Google Tag Manager.
- A submission that arrives **without** one of these click IDs (i.e. an
  organic/direct visitor, not someone who clicked a Google ad) is skipped by
  this integration — there's nothing to attribute it to.
- Uploads happen asynchronously after the submission is stored, with the
  same retry/dead-letter handling as OpenFlow's other integrations; a
  failed upload can be inspected and manually retried from the Integrations
  tab.
