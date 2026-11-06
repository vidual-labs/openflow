<p align="center">
  <a href="https://github.com/vidual-labs/openflow">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/openflow-logo-dark.svg">
      <img src="docs/assets/openflow-logo-light.svg" alt="OpenFlow" width="360">
    </picture>
  </a>
</p>

<p align="center">
  <strong>Open-source form builder for lead generation.</strong><br>
  A self-hosted alternative to Typeform and Heyflow.
</p>

<p align="center">
  <a href="https://github.com/vidual-labs/openflow/releases"><img alt="Version" src="https://img.shields.io/github/package-json/v/vidual-labs/openflow?filename=backend%2Fpackage.json&label=version&color=6C5CE7"></a>
  <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/github/license/vidual-labs/openflow?color=00CEC9"></a>
  <a href="https://github.com/vidual-labs/openflow/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/vidual-labs/openflow/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/vidual-labs/openflow/pkgs/container/openflow"><img alt="Docker image on GHCR" src="https://img.shields.io/badge/ghcr.io-vidual--labs%2Fopenflow-2496ED?logo=docker&logoColor=white"></a>
  <a href="https://github.com/vidual-labs/openflow/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/vidual-labs/openflow?style=flat&logo=github&color=A29BFE"></a>
</p>

<p align="center">
  <img src="docs/assets/readme/hero.webp" alt="An OpenFlow lead form with an animated gradient background, on desktop and on a phone" width="860">
</p>

<p align="center">
  <a href="#-features">Features</a> ·
  <a href="#-screenshots">Screenshots</a> ·
  <a href="#-works-with-lodgely-and-calon">lodgely &amp; calon</a> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="ROADMAP.md">Roadmap</a>
</p>

Multi-step lead forms, one question per screen, on your own server. One Docker
container, a SQLite file, no per-response pricing, and no tracking you didn't add.

## ✨ Features

<img src="docs/assets/readme/form-flow.svg" align="right" width="340" alt="Animated example: a form step is answered, a number is set, then the thank-you screen appears">

- **15 field types**: text, choice, image/icon select, number stepper, date ranges, a Date & Timeslot picker, file upload, address and more
- **Logic**: show or hide steps based on earlier answers, two questions on one screen, budget options filtered by an earlier answer
- **Design per form**: colours, fonts, five animated backgrounds, a landing-page header, custom CSS, EN/DE strings
- **Integrations**: signed webhooks, e-mail, Google Sheets, Google Ads offline conversions, Meta Conversions API. Failed deliveries are retried
- **Analytics**: views → starts → completions, drop-off and time per step, compared with an earlier period
- **Embed anywhere**: iframe with auto-resize, a WordPress plugin, custom slugs, per-form subdomains, GTM behind a cookie banner
- **Secure defaults**: server-side sessions, opt-in e-mailed 2FA, account lockout, password re-entry for sensitive actions, encrypted write-only secrets
- **Operations**: multiple users, read-only API tokens, scheduled backups, an audit log, a health check

<br clear="right">

→ **[The full feature list](docs/features.md)**

## 📸 Screenshots

**What visitors see.** A booking form with its own time slots, and a holiday-home enquiry on its own subdomain:

<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/assets/readme/form-booking.webp" alt="Date & Timeslot step: a month calendar with a picked day and a column of times"></td>
    <td width="50%" valign="top"><img src="docs/assets/readme/form-rental.webp" alt="Date range step: two months with a selected stay highlighted"></td>
  </tr>
</table>

**What you work in.** The form editor: question cards, the field type picker and a stable key per field:

<p align="center"><img src="docs/assets/readme/admin-editor.webp" alt="Form editor with question cards, field keys and an expanded Single Choice question" width="860"></p>

Per-form analytics: where visitors drop off, compared with the previous period:

<p align="center"><img src="docs/assets/readme/admin-analytics.webp" alt="Form analytics: KPIs against the previous period, drop-off and time per step, and a daily trend" width="860"></p>

<details>
<summary><strong>More: responses and the form list</strong></summary>
<br>
<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/assets/readme/admin-submissions.webp" alt="Responses table with one column per question and a CSV export button"></td>
    <td width="50%" valign="top"><img src="docs/assets/readme/admin-dashboard.webp" alt="Form list with live and draft forms and their response counts"></td>
  </tr>
</table>
</details>

<sub>All data in the screenshots is made up.</sub>

## 🔗 Works with lodgely and calon

<p align="center">
  <img src="docs/assets/readme/ecosystem.svg" alt="A visitor's answers go to OpenFlow. OpenFlow reads free slots from calon and books there, calon syncs with Google Calendar or Microsoft 365, and lodgely pulls the finished leads from OpenFlow" width="860">
</p>

OpenFlow runs fine on its own. Two optional self-hosted companions add to it:

- **[calon](https://github.com/vidual-labs/calon)** turns a Date & Timeslot field into real booking. The form shows calon's conflict-checked availability, and the picked slot is booked before the lead is stored. If calon's resource is connected to Google Calendar or Microsoft 365, the booking also lands in that calendar. → [Setup](docs/integrations/calon.md)
- **[lodgely](https://github.com/vidual-labs/lodgely)** is a lead intake hub. It pulls each form's submissions with a read-only API token and maps them onto its lead fields by their stable field keys. → [Setup](docs/integrations/lodgely.md)

## 🚀 Quick start

```bash
git clone https://github.com/vidual-labs/openflow.git
cd openflow
docker compose pull
docker compose up -d
```

Open `http://localhost:3000` and sign in as `admin@openflow.local`. On first start
OpenFlow generates a one-time password and prints it once to the log
(`docker compose logs app`). It never ships a default password.

To update, run `git pull && docker compose pull && docker compose up -d`. Your data
stays in the `db-data` volume. For environment variables, TLS and reverse proxies, see
[configuration](docs/configuration.md) and [security & production](docs/production.md).

## 📚 Documentation

| Page | What's in it |
|------|--------------|
| [Features](docs/features.md) | Every feature, field type and analytics metric |
| [Installation & configuration](docs/configuration.md) | Install, update, all environment variables |
| [Integrations](docs/integrations/README.md) | Webhook, e-mail, Sheets, Google Ads, Meta, [lodgely](docs/integrations/lodgely.md), [calon](docs/integrations/calon.md) |
| [Embedding & tracking](docs/embedding.md) | iframe, WordPress, slugs, GTM events, cookie banner |
| [Custom subdomains](docs/subdomains.md) | A subdomain per form behind one wildcard certificate |
| [API endpoints](docs/api.md) | Routes, auth and read-only API tokens |
| [Security & production](docs/production.md) | Secure defaults, proxies, backups, known gaps |
| [Development](docs/development.md) | Running from source, tests, repository layout |

## 🗺️ Roadmap

Planned next: a versioned submission contract and signed webhook for lodgely,
answer-based routing, hidden fields and UTM capture, spam protection, partial
submissions, and GDPR retention and erasure. Details in **[ROADMAP.md](ROADMAP.md)**.

## Ethical use

OpenFlow is a marketing tool. As a non-binding request, please don't use it for
clients in weapons and armaments, fossil-fuel energy (extraction, refining,
distribution, generation), or internal-combustion passenger vehicles (electric vehicles, bicycles and public transit are fine). This
is a request from the maintainers, not a legal restriction. See the preamble in
[LICENSE](LICENSE).

## 📄 License

GPL 3.0, see [LICENSE](LICENSE).
