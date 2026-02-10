# OpenFlow

Open-source form builder for lead generation. A self-hosted alternative to Typeform and Heyflow.

## Features

- **Multi-Step Forms** - Typeform-style one-question-at-a-time experience with smooth animations
- **10 Field Types** - Text, Email, Phone, Textarea, Number, Date, Single Select, Multi Select, Yes/No, Rating
- **Visual Editor** - Reorder questions, define options, set required fields
- **Theme Customization** - Customize colors and branding per form
- **GTM Integration** - Google Tag Manager configurable per form, with step and submit events
- **iframe Embed** - Embed forms into existing landing pages (with auto-resize)
- **CSV Export** - Download all submissions as CSV
- **Responsive** - Optimized for mobile and desktop
- **Rate Limiting** - Redis-based spam protection
- **Docker** - One command to start

## Quick Start with Docker

```bash
git clone https://github.com/your-org/openflow.git
cd openflow
docker compose up -d
```

The app runs on `http://localhost:3000`.

**Default Login:**
- Email: `admin@openflow.local`
- Password: `admin123`

## Configuration

Environment variables (in `.env` or docker-compose):

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `change-me-in-production` | JWT Signing Key |
| `ADMIN_EMAIL` | `admin@openflow.local` | Admin email |
| `ADMIN_PASSWORD` | `admin123` | Admin password (only on first start) |
| `REDIS_URL` | `redis://redis:6379` | Redis connection |
| `PORT` | `3000` | Server port |

## Architecture

```
openflow/
├── backend/          # Express API + SQLite + Redis
│   └── src/
│       ├── index.js          # Server entry point
│       ├── models/           # DB + Redis
│       ├── middleware/        # Auth
│       └── routes/           # API endpoints
├── frontend/         # React (Vite)
│   └── src/
│       ├── components/       # FormRenderer
│       ├── pages/            # Admin + Public Views
│       └── styles/           # CSS
├── Dockerfile
└── docker-compose.yml
```

## API Endpoints

### Public (no auth)
- `GET /api/public/form/:slug` - Load form
- `POST /api/public/form/:slug/submit` - Submit response

### Admin (auth required)
- `POST /api/auth/login` - Log in
- `GET /api/forms` - List all forms
- `POST /api/forms` - Create form
- `PUT /api/forms/:id` - Update form
- `DELETE /api/forms/:id` - Delete form
- `GET /api/submissions/:formId` - Get submissions
- `GET /api/submissions/:formId/export` - CSV export

## Embedding

### Simple iFrame

```html
<iframe
  src="https://your-domain.com/embed/FORM_SLUG"
  width="100%" height="600"
  frameborder="0"
  style="border:none;border-radius:12px;">
</iframe>
```

### iFrame with Auto-Resize

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

OpenFlow automatically pushes events to the Google Tag Manager dataLayer:

| Event | Trigger | Data |
|-------|---------|------|
| `openflow_step` | Each step change | `formId`, `stepIndex`, `stepId` |
| `openflow_submit` | Form submitted | `formId`, `formTitle` |

## Development

```bash
# Start backend
cd backend && npm install && npm run dev

# Start frontend (in new terminal)
cd frontend && npm install && npm run dev
```

Frontend dev server: `http://localhost:5173` (proxies API to port 3000)

## Roadmap

- **Phase 1** (current): iframe embed, GTM, Admin UI, CSV export
- **Phase 2**: Google Sheets integration, email notifications, webhook support
- **Phase 3**: Conditional logic, file uploads, custom CSS per form

## License

MIT
