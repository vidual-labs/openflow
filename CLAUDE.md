# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OpenFlow** is an open-source, self-hosted form builder for lead generation. It's a Typeform/Heyflow alternative with a multi-step form builder, conditional logic, integrations (webhooks, email, Google Sheets), analytics, and a WordPress plugin.

**Current Version**: 0.7.4 (see version badge in README.md and CHANGELOG.md)

## Architecture

OpenFlow is a **full-stack application** with three main components:

### Backend (Express + SQLite)
- **Location**: `backend/src/`
- **Technology**: Node.js + Express.js + SQLite (better-sqlite3)
- **Key Files**:
  - `index.js` — Server entry point, route initialization
  - `models/db.js` — Database schema and migrations
  - `models/integrations.js` — Integration engine (webhooks, email, Google Sheets)
  - `middleware/auth.js` — JWT authentication
  - `routes/` — API endpoints (forms, submissions, integrations, analytics, auth)
- **Database**: SQLite stored in Docker volume (`db-data`) for persistence
- **Key Features**: Rate limiting, JWT auth, HMAC-signed webhooks, SMTP email, Google Sheets integration, analytics tracking

### Frontend (React + Vite)
- **Location**: `frontend/src/`
- **Technology**: React 18 + Vite + React Router
- **Key Files**:
  - `pages/FormEditor.jsx` — Form builder UI (add fields, conditional logic, theme settings)
  - `pages/FormView.jsx` — Public form display (read-only preview)
  - `pages/Dashboard.jsx` — Admin panel (list forms, manage users)
  - `pages/Analytics.jsx` — Funnel and drop-off analysis
  - `pages/Submissions.jsx` — View and export submissions
  - `components/FormRenderer.jsx` — Renders published forms with animations and validations
  - `components/IntegrationsPanel.jsx` — Configure webhooks, email, Google Sheets per form
- **API Client**: `api.js` — Wrapper for backend API calls
- **Dev Server**: Vite with proxy to backend (port 3000)

### WordPress Plugin
- **Location**: `wordpress-plugin/openflow/`
- **Features**: Shortcode `[openflow]`, WPBakery element, Gutenberg block
- **Key Files**: `openflow.php`, `block.js`

### Infrastructure
- **Docker**: Single `docker-compose.yml` with backend and frontend services
- **Database**: SQLite (zero-config, no external DB)
- **Deployment**: Docker Compose (one-command deployment)

## Development Setup

### Start Backend
```bash
cd backend
npm install
npm run dev
```
Server runs on `http://localhost:3000`. The backend serves the API and hosts the compiled frontend.

### Start Frontend (separate dev server)
```bash
cd frontend
npm install
npm run dev
```
Dev server on `http://localhost:5173` with hot reload. Proxies API requests to backend.

### With Docker
```bash
docker compose up -d --build
# Access at http://localhost:3000
# Default login: admin@openflow.local / admin123
```

## Key Development Patterns

### Form Structure (Backend)
A form is a document with:
- **Fields**: Array of steps, each with field type, label, placeholder, validation, etc.
- **Theme**: Colors, fonts, animated backgrounds, button position
- **Integrations**: Webhooks, email notifications, Google Sheets
- **Landing Page**: Optional logo, headline, subline, footer links
- **Conditional Logic**: Show/hide rules based on previous answers (stored in step config)

### Form Field Types
15 types: Short Text, Long Text, Number, Date, Single Choice, Multiple Choice, Yes/No, Rating, Image/Icon Select, File Upload, Email, Phone, Website URL, Address, Consent/GDPR. Each has validation, placeholder, help text, and conditional visibility.

### Integration Engine (`models/integrations.js`)
Handles all outbound data flows:
- **Webhook**: POST/PUT with optional HMAC-SHA256 signing
- **Email**: SMTP with HTML-formatted submission table
- **Google Sheets (Simple)**: Via Apps Script URL
- **Google Sheets (Service Account)**: Via JSON key, auto-creates headers
Each integration has an enabled flag and test endpoint.

### Analytics
Tracks per-form and global stats: views, starts, completions, conversion rates, step drop-off. Data stored in `analytics` table.

## Testing

```bash
# Backend tests (Jest)
cd backend
npm test

# Run single test file
npm test -- auth.test.js

# Watch mode
npm test -- --watch
```

Tests cover: authentication, authorization, rate limiting, field validation.

## Version Management

**Important**: Every commit must include a version bump.

Version files to update:
1. **README.md** — Update badge: `# 🌊 OpenFlow v0.X.X`
2. **CHANGELOG.md** — Add new entry with date and changes
3. **backend/package.json** — Update `version` field
4. **frontend/package.json** — Update `version` field

**Version Format**: Semantic versioning (e.g., 0.7.4)
- Patch (0.7.4 → 0.7.5): Bug fixes
- Minor (0.7.0 → 0.8.0): New features
- Major (1.0.0): Breaking changes

## Database Schema

Key tables:
- `forms` — Form metadata (title, slug, published, theme, integrations config)
- `fields` — Form steps/fields (type, label, options, conditional logic)
- `submissions` — User responses (per-form submissions with data JSON)
- `submissions_events` — Analytics events (views, starts, completions, step tracking)
- `integrations` — Integration configs per form (webhook URL, email SMTP, Google Sheets)
- `users` — Admin users (email, hashed password, role)

## API Structure

- **Public** (`/api/public/`): No auth required. Load form, submit response, track analytics.
- **Admin** (`/api/forms`, `/api/submissions`, `/api/auth`): JWT auth required.
- **Integrations** (`/api/integrations`): Test, create, update, delete integrations.
- **Analytics** (`/api/analytics`): Get funnel and trend data.

## Common Tasks

### Add a New Field Type
1. Update `backend/src/models/db.js` — Add validation logic
2. Update `frontend/src/components/FormRenderer.jsx` — Render the input
3. Update form schema/types if needed
4. Test in FormEditor and FormView

### Add a New Integration
1. Add integration type in `backend/src/models/integrations.js` (handle `test()` and `execute()`)
2. Update `frontend/src/components/IntegrationsPanel.jsx` — Add config form
3. Add validation in backend routes

### Deploy
```bash
git pull
docker compose up -d --build
# Data persists in db-data volume
```

### Reset Database
```bash
docker compose down -v  # Removes db-data volume
docker compose up -d --build
```

## Important Notes

- **SQLite**: All data is in the SQLite database. The Docker volume `db-data` persists data across restarts.
- **Rate Limiting**: In-memory rate limiter in `models/rateLimit.js` (no external Redis).
- **HMAC Signing**: Webhooks can be signed with a shared secret for security.
- **Conditional Logic**: Stored as rules array in field config. Evaluated client-side during form render.
- **Form Slugs**: Unique URL identifier for public form access (e.g., `/embed/my-form-slug`).
- **Multi-User**: Admin can invite users and assign roles. Role-based access control in `middleware/auth.js`.

## Conventions

- **Form IDs**: UUIDs
- **Field IDs**: nanoid (short unique strings)
- **Naming**: camelCase in JavaScript, snake_case in SQL/database
- **Colors**: Hex format (e.g., `#FF5733`)
- **Timestamps**: ISO 8601 format in database
