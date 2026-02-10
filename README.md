# OpenFlow

Open-Source Formular-Builder fuer Lead-Generierung. Eine selbst-gehostete Alternative zu Typeform und Heyflow.

## Features

- **Multi-Step Formulare** - Typeform-aehnliche Frage-fuer-Frage Darstellung mit Animationen
- **10 Feldtypen** - Text, E-Mail, Telefon, Textfeld, Zahl, Datum, Auswahl, Mehrfachauswahl, Ja/Nein, Bewertung
- **Visueller Editor** - Fragen sortieren, Optionen definieren, Pflichtfelder setzen
- **Theme-Anpassung** - Farben und Branding anpassen
- **GTM-Integration** - Google Tag Manager pro Formular konfigurierbar, Step- und Submit-Events
- **iframe-Embed** - Formulare in bestehende Landing Pages einbetten (mit Auto-Resize)
- **CSV-Export** - Alle Antworten als CSV herunterladen
- **Responsive** - Optimiert fuer Mobile und Desktop
- **Rate Limiting** - Redis-basierter Spam-Schutz
- **Docker** - Ein Befehl zum Starten

## Schnellstart mit Docker

```bash
git clone https://github.com/your-org/openflow.git
cd openflow
docker compose up -d
```

Die App laeuft auf `http://localhost:3000`.

**Standard-Login:**
- E-Mail: `admin@openflow.local`
- Passwort: `admin123`

## Konfiguration

Umgebungsvariablen (in `.env` oder docker-compose):

| Variable | Standard | Beschreibung |
|----------|----------|-------------|
| `JWT_SECRET` | `change-me-in-production` | JWT Signing Key |
| `ADMIN_EMAIL` | `admin@openflow.local` | Admin E-Mail |
| `ADMIN_PASSWORD` | `admin123` | Admin Passwort (nur bei Erststart) |
| `REDIS_URL` | `redis://redis:6379` | Redis Verbindung |
| `PORT` | `3000` | Server Port |

## Architektur

```
openflow/
├── backend/          # Express API + SQLite + Redis
│   └── src/
│       ├── index.js          # Server-Einstiegspunkt
│       ├── models/           # DB + Redis
│       ├── middleware/        # Auth
│       └── routes/           # API Endpunkte
├── frontend/         # React (Vite)
│   └── src/
│       ├── components/       # FormRenderer
│       ├── pages/            # Admin + Public Views
│       └── styles/           # CSS
├── Dockerfile
└── docker-compose.yml
```

## API Endpunkte

### Public (kein Auth)
- `GET /api/public/form/:slug` - Formular laden
- `POST /api/public/form/:slug/submit` - Antwort absenden

### Admin (Auth erforderlich)
- `POST /api/auth/login` - Anmelden
- `GET /api/forms` - Alle Formulare
- `POST /api/forms` - Formular erstellen
- `PUT /api/forms/:id` - Formular aktualisieren
- `DELETE /api/forms/:id` - Formular loeschen
- `GET /api/submissions/:formId` - Antworten abrufen
- `GET /api/submissions/:formId/export` - CSV Export

## Einbetten

### Einfacher iFrame

```html
<iframe
  src="https://your-domain.com/embed/FORM_SLUG"
  width="100%" height="600"
  frameborder="0"
  style="border:none;border-radius:12px;">
</iframe>
```

### iFrame mit Auto-Resize

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

## GTM Events

OpenFlow pusht automatisch Events an den Google Tag Manager:

| Event | Trigger | Daten |
|-------|---------|-------|
| `openflow_step` | Jeder Schritt-Wechsel | `formId`, `stepIndex`, `stepId` |
| `openflow_submit` | Formular abgesendet | `formId`, `formTitle` |

## Entwicklung

```bash
# Backend starten
cd backend && npm install && npm run dev

# Frontend starten (in neuem Terminal)
cd frontend && npm install && npm run dev
```

Frontend-Dev-Server: `http://localhost:5173` (proxied API zu Port 3000)

## Roadmap

- **Phase 1** (aktuell): iframe-Embed, GTM, Admin UI, CSV Export
- **Phase 2**: Google Sheets Integration, E-Mail-Benachrichtigungen, Webhook-Support
- **Phase 3**: Conditional Logic, File Uploads, Custom CSS pro Formular

## Lizenz

MIT
