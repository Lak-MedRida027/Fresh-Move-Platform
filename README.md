# Fresh Move website (v2)

Official website of **Fresh Move** ([@fresh_move1](https://www.instagram.com/fresh_move1/)), an Algerian
outdoor adventure and travel club: hiking, desert, camping, coast and heritage.
*El move لي تفرح القلب 🍀*

**Public site**
- Darja (Algerian Arabic, right-to-left) at `/`, English at `/en/`; dark / light mode; mobile first
  (most visitors come from Instagram's in-app browser).
- Upcoming trips with live seats left; **book a seat** (or join the waitlist) with name, phone, wilaya and
  age; a booking code; **Check my reservation** with phone + code. Payment proof still goes by Instagram DM.
- Past trips with photo galleries and filters; membership form; privacy page.

**Admin dashboard** (`/admin`, Darja and English)
- Sign-in with password **and** an authenticator app (MFA), invitation emails, password reset, sign-out
  after 2 hours idle; roles **owner** / **organizer**.
- Trips (draft → open → closed → completed), bookings (confirm payment, cancel, waitlist promotion, hold
  extension, notes, DM bookings, bulk actions), members, admins, audit log, settings.
- Photos resized in the browser to 3 WebP sizes with location data removed; descriptions in both languages.
- **Excel export** of a trip's bookings, all bookings or members, with the page's filters.
- Background jobs (expire unpaid holds, privacy clean-up, keep-alive) shown on the overview.

The old v1 site (`freshmove-seven.vercel.app`) forwards here once v2 is deployed.

## Stack

| | |
|---|---|
| Framework | [Astro 7](https://astro.build) + TypeScript (strict), server-rendered on **Cloudflare Workers** (`@astrojs/cloudflare`) |
| Data | **Supabase**: Postgres with row-level security everywhere, Auth (email + TOTP MFA), Storage for photos |
| Jobs | Cloudflare Cron Triggers (every 15 min, daily), `src/worker.ts` |
| Bot protection | Cloudflare Turnstile + rate limits (Cloudflare binding per IP, database per phone/code) |
| Styling | Plain CSS with brand tokens (`src/styles/tokens.css`), logical properties for RTL |
| Client JS | Small per-page scripts, no framework. Admin only: the photo pipeline (Canvas, WebAssembly WebP fallback) and exceljs, both loaded on demand |
| Tests | Vitest (unit, API, database), Playwright (3 browsers) + axe, backup/restore round trip |
| CI | GitHub Actions: everything above against a local Supabase stack |
| Backups | Weekly GitHub Action: `supabase db dump` + photos, encrypted with age |

## Run it locally

**You need:** Node 24 (`.nvmrc`), Git, and **Docker Desktop running** (the local Supabase stack runs in
Docker). Nothing touches production.

```bash
npm install
npm run db:start        # local Supabase in Docker (first time: downloads the images, a few minutes)
npm run setup:local     # writes .env and .dev.vars for the local stack (Turnstile test keys)
npm run db:seed         # the 14 v1 trips with their photos
```

Create your local admin account (the password is only for your machine):

```bash
node scripts/with-local-supabase.mjs node scripts/create-owner.ts you@example.test --password "a long local password"
```

Start the site:

```bash
npm run dev             # http://localhost:4321  ·  admin: http://localhost:4321/admin/
```

- **First admin sign-in:** after the password, scan the QR code with an authenticator app (Google
  Authenticator, Aegis, 1Password…) and enter the code.
- **Emails** (invitations, password resets) don't leave your machine: open the local mailbox at
  http://127.0.0.1:54324.
- **Bookings and the membership form** work locally: the Turnstile test keys always pass.
- **Run the scheduled jobs by hand:** `curl -X POST -H "Authorization: Bearer <CRON_SECRET from .dev.vars>" http://localhost:4321/api/cron/frequent` (or `/daily`).
- **Like production:** `npm run build && npm run preview` runs the built Worker on workerd with the real
  security headers.
- **Database browser:** `npx supabase status` lists the local URLs (Studio, API, database).
- **Stop:** `npm run db:stop` (data is kept). **Start over:** `npm run db:reset && npm run db:seed`.

## Tests

```bash
npx playwright install --with-deps chromium webkit   # once
npm run test:all        # type check, lint, unit + API, build, e2e + accessibility (3 browsers)
npm run test:db         # seats and concurrency, row-level security, storage, jobs, retention
npm run db:lint         # SQL lint + Supabase Security/Performance Advisors (must be clean)
npm run backup:test     # backup → wipe → restore of the LOCAL stack; every count must match
```

All of them run in CI on every push. The database, e2e and backup tests refuse to run against anything but
the local stack (they create bookings and members); check a deployed site with `npm run smoke -- <url>`,
which only reads.

## Deploy

Step by step, with where every key comes from: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

In short: create the Supabase project (EU) and push the migrations; create the Cloudflare account and
Turnstile widget; put the public values in `.env.production` and the secrets in Cloudflare
(`npx wrangler secret put`); `npm run deploy`; `npm run smoke -- <site url>`; seed the past trips, create the
first owner, import the v1 members; set up the weekly backup; switch the old Vercel address to a redirect.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (needs the local stack) |
| `npm run build` / `npm run preview` | Production build / run it on workerd |
| `npm run deploy` | Build with `.env.production` and `wrangler deploy` (refuses local/test values and secrets) |
| `npm run smoke -- <url>` | Read-only checks of a deployed site |
| `npm run check` / `npm run lint` | `astro check` + `tsc` / ESLint |
| `npm test`, `npm run test:e2e`, `npm run test:db`, `npm run test:all` | Tests (see above) |
| `npm run db:start` / `db:stop` / `db:reset` / `db:seed` | Local Supabase stack |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` after a migration |
| `npm run db:lint` | plpgsql lint + Advisors |
| `npm run setup:local` | `.env` + `.dev.vars` for the local stack |
| `npm run backup` / `npm run restore` / `npm run backup:keygen` / `npm run backup:test` | Encrypted backups ([docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md)) |
| `node scripts/import-members.ts <csv>` | Import the v1 members sheet (dry run unless `--commit`) |
| `node scripts/create-owner.ts <email>` | First owner (invitation in production, password locally) |
| `npm run lighthouse`, `npm run screenshots`, `npm run copy-review`, `npm run icons` | Quality and asset tools |

## Configuration

| File | What | In Git |
|---|---|---|
| `.env` / `.dev.vars` | Local stack values and secrets (`npm run setup:local`) | no |
| `.env.production` | Production **public** build values ([example](.env.production.example)) | no |
| Cloudflare secrets | `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `CRON_SECRET` | no |
| `wrangler.jsonc` | Worker name, cron schedules, rate limits | yes |
| `supabase/config.toml` | Local stack only (auth, email templates, ports) | yes |
| `supabase/migrations/` | The database: tables, functions, security rules, storage. Never edit production by hand | yes |

## Project structure

```
src/
  pages/                 Routes: / and /en/ trees, admin, api/ (reserve, status, join, cron)
  views/                 Page bodies shared by both languages (views/admin/ for the dashboard)
  components/            Site and admin components
  layouts/               BaseLayout (public), AdminLayout
  lib/                   Server and shared logic:
    admin/                 admin data loading, forms, auth rules, storage helpers
    excel/                 export description (server) + workbook builder (browser)
    images/                browser photo pipeline (resize, strip metadata, WebP)
    supabase/              per-request client (admin, RLS) and secret-key client (server only)
    jobs.ts                scheduled jobs; form-guard.ts / *-handler.ts: public form endpoints
    security-headers.ts    CSP and other headers
  i18n/                  ar.json, en.json (site) and admin.ar.json, admin.en.json (dashboard): same keys
  scripts/               Small client scripts
  middleware.ts          Admin guard (session, MFA, role, idle timeout) + security headers
  worker.ts              Worker entry: Astro + scheduled jobs
supabase/                migrations/, templates/ (admin emails), seed-data/, config.toml
scripts/                 deploy, smoke, seed, owner, members import, backup/restore, local tools
tests/                   unit/, api/, db/, e2e/
vercel-redirect/         The old Vercel project becomes a 301 redirect
docs/                    Guides (below)
```

## Security, in short

- **Row-level security on every table**; the browser only has the publishable key. Admin access is checked
  **in the database** (`is_admin()` needs an MFA session), not just in the pages.
- Public forms: JSON only, size limit, honeypot, minimum fill time, Turnstile, rate limits per IP and per
  phone/code; bookings never reveal someone else's code.
- Strict CSP (no inline scripts except the theme bootstrap, by hash); `'wasm-unsafe-eval'` only on the
  admin photos page. HSTS, `nosniff`, `DENY` framing, no-store and `noindex` on admin and API responses.
- Every admin change and every export is in the audit log. Retention removes personal data after
  `retention_months` (default 12), in bookings and in the audit log; a member delete removes theirs at once.
- Backups are encrypted before they leave the runner (the repository is public).

## Docs

- [Deploying v2](docs/DEPLOY.md) · [Custom domain](docs/CUSTOM_DOMAIN.md) · [Backups and restore](docs/BACKUP_RESTORE.md)
- [Data model](docs/DATA_MODEL.md) · [Trip photos](docs/IMAGES.md) · [Excel exports](docs/EXPORTS.md)
- [v2 plan](docs/V2_PLAN.md) · [Debug log](docs/DEBUG_LOG.md) · [Copy review (Darja strings)](docs/COPY_REVIEW.md)
- v1 only, kept for history: [Adding a trip (Markdown)](docs/ADDING_A_TRIP.md), [Google Sheets](docs/GOOGLE_SHEETS_SETUP.md)
- Brand: [identity file](docs/brand/Fresh_Move_Identity_File.md), [brand kit](docs/brand/Fresh%20Move%20Brand%20Kit.html)
