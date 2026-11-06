# Fresh Move website

Official website of **Fresh Move** ([@fresh_move1](https://www.instagram.com/fresh_move1/)), an Algerian
outdoor adventure and travel club: hiking, desert, camping, coast and heritage.
*El move لي تفرح القلب 🍀*

- Darja (Algerian Arabic, RTL) at `/`, English at `/en/`
- Past trips gallery with filters, trip pages with an accessible photo viewer
- Membership form → Google Sheet (via a server endpoint and Google Apps Script)
- Trips are **only** booked on Instagram; the site never takes bookings or payments
- Dark / light mode, mobile first (most visitors come from the Instagram in-app browser)

Live: **https://fresh-move.vercel.app** <!-- TODO: update after deploy if the URL differs -->

## Stack

| | |
|---|---|
| Framework | [Astro 7](https://astro.build) + TypeScript (strict), static pages + one server route |
| Hosting | Vercel (`@astrojs/vercel`), `/api/join` is the only serverless function |
| Styling | Plain CSS with design tokens from the brand kit (`src/styles/tokens.css`), logical properties for RTL |
| Fonts | Self-hosted via `@fontsource`: Oswald, Noto Sans Arabic, Inter |
| Images | `astro:assets` (AVIF/WebP, responsive, lazy) |
| Content | Astro content collection `src/content/trips/*.md` |
| Tests | Vitest (unit + API), Playwright (e2e, 3 browsers) + axe-core, Lighthouse script |
| CI | GitHub Actions: check, lint, test, test:e2e |

Client JavaScript is ~12 KB total, split per page (theme/menu, filters, lightbox, form). No framework runtime.

## Run locally

Requires Node 24 (see `.nvmrc`).

```bash
npm install
npm run dev            # http://localhost:4321
```

The form needs `SHEETS_WEBHOOK_URL` and `SHEETS_WEBHOOK_SECRET` (copy `.env.example` to `.env`).
Without them, `/api/join` answers `503` and the form shows its error message with the Instagram DM link.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (`.vercel/output`) |
| `npm run preview` | Preview the build |
| `npm run serve:dist` | Serve the built static files **with the `vercel.json` headers** (real CSP) on :4321 |
| `npm run check` | `astro check` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit + API tests (Vitest) |
| `npm run test:e2e` | Build, then Playwright e2e + accessibility tests (Pixel 7, iPhone 14, desktop Chrome) |
| `npm run test:all` | All of the above |
| `npm run lighthouse` | Lighthouse mobile on key pages (needs `serve:dist` running) |
| `npm run screenshots` | Full-page screenshots → `docs/screenshots/` (needs `serve:dist` running) |
| `npm run copy-review` | Regenerate `docs/COPY_REVIEW.md` from the Darja strings |
| `npm run placeholders` | Generate placeholder photos for trips that don't have any |
| `npm run icons` | Rebuild favicons / app icons from `public/brand/logo.*` |

First time running e2e: `npx playwright install chromium webkit`.

## Deploy

The project is connected to Vercel through GitHub: every push to `main` deploys to production, and
every pull request gets a preview URL. Manual deploy: `npx vercel --prod`.

### Environment variables (Vercel → Settings → Environment Variables, Production + Preview)

| Name | Purpose |
|---|---|
| `SHEETS_WEBHOOK_URL` | Google Apps Script Web App URL (server-only) |
| `SHEETS_WEBHOOK_SECRET` | Shared secret, same as `SHARED_SECRET` in Apps Script (server-only) |
| `SITE_URL` | Optional. Public URL if not `https://fresh-move.vercel.app` (custom domain) |

These are read with `process.env` inside the server route only and never reach the browser.
Setup guide: [docs/GOOGLE_SHEETS_SETUP.md](docs/GOOGLE_SHEETS_SETUP.md).

## Project structure

```
apps-script/Code.gs          Google Apps Script (paste into the Sheet's script editor)
docs/                        Guides, copy review, debug log, screenshots, brand files
public/                      Logo, icons, OG images, robots.txt, manifest (served as-is)
scripts/                     Helper scripts (placeholders, icons, OG image, screenshots, Lighthouse, local server)
src/
  assets/                    Images processed by astro:assets (hero, trip photos)
  components/                Header, Footer, TripCard, JoinForm, Icon, …
  config/site.ts             Instagram links, numbers, MIN_AGE  ← edit me
  content/trips/*.md         One file per trip  ← edit me
  content.config.ts          Trips collection (schema in src/lib/trip-schema.ts)
  data/regions.ts            Regions and destinations
  data/wilayas.ts            The 69 wilayas (verified Nov 2026)
  i18n/ar.json, en.json      Every UI string, same keys in both  ← edit me
  i18n/index.ts              Typed t(), locale/path helpers
  layouts/BaseLayout.astro   <head> (SEO, hreflang, theme bootstrap), header, footer
  lib/membership.ts          Form validation rules (shared by browser + server)
  lib/join-handler.ts        /api/join logic (spam checks, rate limit, forwarding)
  pages/                     Routes: / and /en/ trees, api/join.ts
  scripts/                   Small client scripts (theme, filters, lightbox, form)
  styles/                    tokens.css (brand colors), global.css
  views/                     Page bodies shared by both languages
tests/unit, tests/api, tests/e2e
vercel.json                  Security headers (CSP with the theme script hash), caching
```

## Security notes

- CSP allows no inline script except the theme bootstrap, by SHA-256 hash. `tests/unit/csp.test.ts`
  fails if the script and the hash drift apart. If you edit `src/scripts/theme-init.ts`, update the hash
  in `vercel.json` (the test prints the expected value).
- `/api/join`: JSON only, 4 KB body limit, honeypot, minimum 3 s fill time, 5 requests / 10 min per IP
  (best effort per serverless instance), server-side validation, spreadsheet formula-injection guard,
  generic error messages. Apps Script checks the secret and validates again.

## Docs

- [Adding a trip / real photos](docs/ADDING_A_TRIP.md)
- [Google Sheets setup](docs/GOOGLE_SHEETS_SETUP.md)
- [Copy review (all Darja strings)](docs/COPY_REVIEW.md)
- [Custom domain](docs/CUSTOM_DOMAIN.md)
- [Debug log](docs/DEBUG_LOG.md)
- Brand: [identity file](docs/brand/Fresh_Move_Identity_File.md), [brand kit](docs/brand/Fresh%20Move%20Brand%20Kit.html)
