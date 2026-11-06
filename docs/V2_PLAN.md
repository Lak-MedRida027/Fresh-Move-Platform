# Fresh Move v2: plan

Status: **draft, waiting for the owner's OK** (phase 1 of 10). Nothing in the codebase has changed yet.

v2 adds seat reservations on the website, an admin dashboard (trips, reservations, members, photos,
Excel export), moves data to Supabase and hosting to Cloudflare. Everything from v1 still applies:
brand tokens, Darja/English i18n with key parity, RTL logical CSS, dark/light without flash, WCAG 2.1 AA,
strict CSP, Lighthouse targets, test discipline.

---

## 0. Decisions I need from you (before phase 2)

| # | Decision | My recommendation |
|---|---|---|
| D1 | **Local Supabase needs Docker.** Docker Desktop is installed here but not running. | **Start Docker Desktop** (and keep it on while we work). Tests then run against `supabase start`, and CI uses the same thing. Otherwise I'll need you to create a second free project `fresh-move-dev`. Note: Supabase allows **2 free projects** per account, so dev + prod uses both. |
| D2 | **Admin UI technology.** The admin needs drag-to-reorder, multi-file upload with progress, bulk-select tables. | **Preact islands, admin only** (~4 KB). The public site stays framework-free (current ~12 KB of JS). The alternative is plain TypeScript; it works, but costs more code for the uploader and tables. |
| D3 | **Image bandwidth.** Supabase Free includes 5 GB egress per month. Photos served straight from Supabase Storage can use that up (≈ 300 visitors/day × ~1 MB of images ≈ 9 GB/month). | Keep **Supabase Storage** as the brief says, but serve images through the site (`/media/...`) with long immutable caching, so repeat views come from Cloudflare's cache. This is fully effective only on a custom domain (see R2). If it's still too much, moving photos to Cloudflare R2 (10 GB free, no egress fees) is a contained change: only the storage adapter changes. |
| D4 | **Workers Free = 10 ms CPU per request.** Rendering a full page plus parsing Supabase JSON is usually 2–8 ms, but heavy work isn't possible. | Fine for the public site and admin. **Excel files are generated in the admin's browser**, not on the server (see §6). If CPU errors appear in production, the fallback is Workers Paid ($5/month). I'll report CPU times measured in phase 3. |
| D5 | **Production domain.** Free subdomain will be `fresh-move.<your-account>.workers.dev`. | OK for launch. Edge caching of server-rendered pages only works on a custom domain (R2). Buying a domain later (e.g. `freshmove.club`) is the single best performance upgrade. |
| D6 | **Payment instructions, hold hours, retention.** | Defaults: hold 48 h, max 3 pending holds per person, retention 12 months, all editable in a settings table. The BaridiMob/CCP text is per trip and written by you in the admin. All marked `TODO(owner)`. |

Also pending from v1: the live Google Sheets test was stopped before it ran a second time. The first try
returned 503 (the secrets weren't visible to the deployment), so **no test row exists**. In v2 the form
writes to Supabase; Apps Script becomes deprecated after the members import (§9).

---

## 1. Architecture

```mermaid
flowchart LR
  subgraph CF[Cloudflare Worker: Astro SSR + static assets]
    P[Public pages] --- API[/api/reserve, /api/join, /api/status/]
    A[/admin/* (SSR, noindex)/] --- AAPI[/admin/api/*/]
    CRON[[Cron: */15 min, daily]]
    MW{{Middleware: security headers, admin auth + MFA, origin check}}
  end
  T[Turnstile] -. verify .- API
  P -- publishable key, RLS --> DB[(Supabase Postgres)]
  API -- secret key, after validation --> DB
  A -- admin's own session (RLS is_admin) --> DB
  A -- uploads (browser, admin session) --> S[(Storage: trip-images)]
  P -- /media/* proxy, immutable cache --> S
  CRON -- secret key --> DB
  GH[[GitHub Actions: weekly encrypted pg_dump]] --> DB
```

- **Cloudflare Workers with static assets** (Astro's adapter no longer supports Pages). `@astrojs/cloudflare` 14.x
  with Astro 7, `wrangler` 4.x, `nodejs_compat`. Static files are served without running the Worker.
- **Rendering:** `output: 'server'`. Pages without trip data (privacy, join, reservation-check shell, 404,
  admin login) stay `prerender = true`. Home, trips list and trip pages render on the server.
- **Caching (important):** Cloudflare does **not** cache Worker responses automatically, so an
  `s-maxage` header alone does nothing. I'll add a small edge cache in the Worker (Cache API, 60 s fresh and
  300 s stale-while-revalidate) for public GET pages, plus a 60 s in-memory cache of Supabase reads per
  isolate. The Cache API has no effect on `*.workers.dev` (see R2), so on the free subdomain the in-memory
  cache does the work. Admin and API responses are always `no-store`.
- **Custom Worker entry** (`src/worker.ts`) wraps Astro's handler and adds the `scheduled()` cron handler and the
  edge cache.
- **Security headers:** `_headers` does not apply to Worker responses, so the headers move into Astro
  middleware (all SSR responses) **and** `public/_headers` (static files). Same CSP as today, plus:
  `script-src` + `frame-src https://challenges.cloudflare.com` (Turnstile), `connect-src` the Supabase project
  URL (admin uploads/auth), `img-src 'self' data: blob:` (blob: for upload previews in the admin). Nothing else.
- **Supabase keys:** the new **publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) keys. The legacy
  anon/service_role JWT keys are deprecated by the end of 2026. Env names stay as in the brief:
  `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (holds the publishable key),
  `SUPABASE_SERVICE_ROLE_KEY` (holds the secret key).
- **Least privilege:** the public site reads with the publishable key (RLS applies). Public writes go through
  three server routes using the secret key, **only** to call specific SQL functions. Admin pages use the
  admin's **own session** (RLS + `is_admin()`), never the secret key, so a bug in an admin page can't
  bypass RLS.

## 2. Database

### Tables (brief schema, with these changes)

| Change | Why |
|---|---|
| `reservations.member_id` **nullable**, `ON DELETE SET NULL`, plus `name_snapshot` | Deleting a member (privacy request) or retention anonymisation keeps trip history and counts. |
| `trips.start_date/end_date` nullable **only** for `completed`/`cancelled` (CHECK) | The 14 imported past trips have no known dates ("TBD"). Open trips must have dates. |
| `trips.difficulty` nullable for imported past trips | Unknown for the seed trips. |
| `trip_images.size_bytes`, `placeholder` (tiny base64 WebP, ~200 B) instead of blurhash | No extra library on the public site; the placeholder is a CSS background. The size column feeds the storage meter. |
| `trip_images.mime`, plus `storage_paths` derived from `trips/<trip-id>/<image-id>-{sm,md,lg}.webp` | Predictable paths, so deletions clean up all three files. |
| New `settings` (singleton row): `max_pending_per_person` 3, `retention_months` 12, `max_gallery_images` 60, `default_hold_hours` 48 | Configurable without a deploy (owner only). |
| New `rate_limits(key, window_start, hits)` + `hit_rate_limit(key, max, window)` | Strict per-phone and per-code limits (Cloudflare's binding is per-location and approximate, see §7). |
| `admin_users` + `pending_invites(email, role)` | Owner invites by email from the dashboard. |
| `reservations.hold_extended_at`, waitlist order = `created_at` | "Extend hold" and FIFO promotion. |

Full DDL, indexes and a Mermaid ER diagram go in `docs/DATA_MODEL.md` (phase 2).

### Seat logic: SQL functions (all `SECURITY DEFINER`, `search_path = ''`, fully-qualified names)
- `reserve_seat(...)`: exactly the brief's 7 steps, under `SELECT … FOR UPDATE` on the trip row. Also enforces
  `max_pending_per_person` and per-phone rate limiting. Seats taken = `confirmed` + `pending` with
  `hold_expires_at > now()`, so counts stay right even if the expiry job never runs.
- Reservation code: `FM-` + 5 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O/1/I), unique,
  with retry on collision. A TS helper normalises what people type (lowercase, `fm7k3qx`, O→0 confusion)
  and is unit-tested.
- `trip_public_stats(trip_id)` → `{capacity, seats_left}` only. `trips_public` view for the site.
- Admin functions, re-checking capacity under the trip lock: `admin_confirm(reservation, method, amount, override)`
  (override **owner only**, logged), `admin_cancel`, `admin_promote` (FIFO, capacity-checked),
  `admin_move_to_waitlist`, `admin_extend_hold`, `admin_add_manual_reservation`.
- `expire_holds()`, `anonymise_old_reservations()`, `keep_alive()`. Only the secret key can run these.
- `is_admin()`, `is_owner()`: `SECURITY DEFINER`, check `admin_users` **and** that the session JWT has
  `aal = 'aal2'` (MFA completed). A stolen password without the TOTP code gets no admin access, even in direct
  API calls.
- **Audit:** triggers on `trips`, `trip_images`, `reservations`, `members`, `admin_users`, `settings` write
  `audit_log` (actor = `auth.uid()`, before/after JSON, personal fields kept as in the row). Exports call
  `log_export(entity, id, row_count)`. Every admin write goes through these triggers, so logging is consistent.
- **RLS:** enabled on every table, no policies for `anon`/`authenticated` except `SELECT` on
  `trips` (status open/closed/completed) and their `trip_images`; admin policies via `is_admin()`;
  owner-only via `is_owner()`. `REVOKE EXECUTE … FROM public, anon, authenticated` on every function that
  isn't meant for them. Security and Performance Advisors must be clean.
- **Storage:** bucket `trip-images`, public read, 15 MB limit, MIME `image/webp` (the browser converts
  everything to WebP before upload), insert/update/delete only `is_admin()`.

### Migrations, types, seed
- `supabase/migrations/*.sql` (never hand-edit production), `supabase/seed.sql` for local data,
  `npm run db:types` → `src/lib/database.types.ts` (`supabase gen types`).
- `scripts/seed-trips.ts`: imports the 14 existing trips as `completed` (same slugs, so URLs keep working),
  resizes their placeholder images to sm/md/lg WebP with sharp (Node, build-time) and uploads them.
- `scripts/import-members.ts`: CSV from the Google Sheet → normalise phones (existing `normalizePhone`),
  de-duplicate, `source='import'`, report imported / duplicates / invalid. Dev first, production only
  after your OK.

## 3. Routes

| Route | Render | Notes |
|---|---|---|
| `/`, `/en/` | SSR + edge cache | New "Upcoming trips" section, updated How it works / FAQ |
| `/trips/`, `/en/trips/` | SSR + cache | Upcoming / Past sections, existing filters on both |
| `/trips/[slug]/`, `/en/…` | SSR + cache | Upcoming: details, countdown, seats, reservation form. Past: gallery |
| `/reservation/`, `/en/reservation/` | static shell | Check status (phone + code) |
| `/join/`, `/privacy/`, `/404` | static | Join now writes to Supabase |
| `POST /api/reserve`, `/api/join`, `/api/status` | Worker | Turnstile, honeypot, min time, JSON-only, 4 KB limit, rate limits, generic errors |
| `/media/[...path]` | Worker | Storage proxy, immutable cache (D3) |
| `/admin/login`, `/admin/mfa` | SSR | Password, then TOTP enrol/verify |
| `/admin`, `/admin/trips`, `/admin/trips/[id]` (details · photos · reservations), `/admin/reservations`, `/admin/members`, `/admin/members/[id]`, `/admin/admins`, `/admin/audit`, `/admin/settings` | SSR, `no-store`, `X-Robots-Tag: noindex` | Middleware: session + `aal2` + `is_admin()`; owner-only pages check `is_owner()` |
| `/admin/api/*` | Worker | Same checks; export data endpoints (JSON for the in-browser Excel builder) |

Admin language follows the same `/admin` vs `/en/admin` pattern as the public site, with a switch.

## 4. File structure (new / changed)

```
supabase/                      config.toml, migrations/, seed.sql, tests/ (DB tests run by Vitest)
src/worker.ts                  Worker entry: Astro handler + edge cache + scheduled()
src/middleware.ts              security headers (CSP), admin guard, origin check
src/lib/supabase/              server.ts (SSR cookies, @supabase/ssr), public.ts (publishable), service.ts (secret, server-only)
src/lib/database.types.ts      generated
src/lib/reservations.ts        code normalise/format, Africa/Algiers date formatting
src/lib/turnstile.ts           server verification
src/lib/rate-limit.ts          Cloudflare binding (per IP) + DB limiter (per phone/code)
src/lib/excel/                 export builder (shared by browser + tests), formula-injection guard
src/lib/images/                browser pipeline: decode → orient → strip EXIF → 3 WebP sizes → placeholder
src/components/admin/          Preact islands (uploader, reservations table, reorder list)
src/pages/admin/…, src/pages/api/…
scripts/seed-trips.ts, scripts/import-members.ts, scripts/create-owner.ts, scripts/check-client-secrets.mjs
.github/workflows/ci.yml       + Supabase CLI local stack, DB tests
.github/workflows/backup.yml   weekly encrypted dump
vercel-redirect/vercel.json    301 to the new URL (Vercel project root dir points here)
```
`src/content/trips/` and the Google-Sheet path are retired after the seed (kept in git history).

## 5. Libraries

| Need | Choice | Why |
|---|---|---|
| Adapter | `@astrojs/cloudflare` 14 | Official, Workers + assets |
| DB/Auth | `@supabase/supabase-js` 2, `@supabase/ssr` | Cookie sessions for SSR admin |
| Admin islands | `preact` + `@astrojs/preact` (admin only) | D2 |
| Drag reorder | native pointer/keyboard handlers (no lib) | Accessible: keyboard "move up/down" buttons too |
| Excel | **`exceljs`** in the admin's browser, lazy-loaded only on export | Supports bold frozen header, column widths, auto-filter, text cells, real dates. SheetJS Community can't style cells. Server-side on Workers would exceed 10 ms CPU and the bundle budget. I'll confirm the current version and advisories in phase 7 and log the choice. |
| Images | Canvas + `createImageBitmap(..., {imageOrientation:'from-image'})` + `canvas.toBlob('image/webp', 0.8)` | Re-encoding drops all EXIF/GPS by construction. Tests read uploaded files back and assert no EXIF. HEIC: decoded where the browser can (Safari); otherwise a clear message (iPhones usually send JPEG). |
| Turnstile | plain script tag, no wrapper lib | Tiny, CSP-friendly |
| Tests | Vitest (unit, API, DB), Playwright + axe (unchanged) | Same discipline |

## 6. Excel, images, jobs, backups (summary)
- **Excel:** the admin page fetches rows from an admin-only JSON endpoint (logged with `log_export`), builds the
  `.xlsx` in the browser with exceljs, and downloads it. The same builder is unit-tested in Node: generate,
  parse back, check sheet names, counts, phones as text, injection neutralised, Arabic intact.
- **Images:** per-image progress, 3 sizes (480/960/1600 long side, WebP ~0.8), poster/gallery, cover selection,
  reorder, required alt text in both languages before publishing, delete removes storage objects, storage meter
  with an 80 % warning. `docs/IMAGES.md`.
- **Cron** (Cloudflare Cron Triggers, 2 of the 5 free): every 15 min `expire_holds()`; daily retention +
  keep-alive. Also `POST /api/cron/*` guarded by `CRON_SECRET` for manual runs and tests. Supabase pauses free
  projects after about a week without activity; the daily call prevents that. Confirmed against
  [Supabase's FAQ](https://supabase.com/kb/faqs/platform/free-project-pausing).
- **Backup:** GitHub Actions weekly `supabase db dump` → encrypt with `age` (your public key) → artifact, 30 days.
  `docs/BACKUP_RESTORE.md`, restore tested once into the local/dev database.

## 7. Spam and abuse
- Turnstile (server-verified) + honeypot + ≥ 3 s fill time on reserve / join / status.
- Rate limits: **Cloudflare Rate Limiting binding** per IP (cheap, approximate per location, periods of 10 or 60 s) for
  bursts; **DB limiter** (`hit_rate_limit`) per phone and per reservation code, which is strict and global. Admin
  login: binding per IP plus Supabase Auth's own limits.
- Max 3 active pending holds per person; status check returns the same "not found" for a wrong phone or a wrong code.
- Logs never include names or phones.

## 8. Testing
All existing v1 tests keep passing (adapted where the data source changed). New:
- **DB (Vitest against local Supabase):** 30 parallel `reserve_seat` on capacity 5 → exactly 5 pending and
  25 waitlist; duplicate phone returns the same code; expired hold frees a seat; confirm over capacity blocked,
  owner override logged; FIFO promotion; full RLS matrix (anon, non-admin user, organizer, owner, admin
  without MFA) for every table and operation; storage write permissions.
- **Unit/API:** code normaliser, Algiers time formatting, Excel builder parse-back, every API route (success,
  validation, Turnstile fail (mocked), rate limit, 405, 415, 413), client-bundle secret scan.
- **E2E (mobile + desktop, ar + en, dark + light):** public reserve → code → status; admin login with test
  TOTP → create trip → upload 3 images (assert WebP, sizes, no EXIF/GPS) → poster + reorder → publish → confirm
  reservation → export and verify → complete → appears in Past; full trip → waitlist; closed → no form; every
  `/admin/*` unauthenticated → redirect/401; axe on all public and admin pages. Screenshots → `docs/screenshots/v2/`.
- **CI:** Supabase CLI local stack in GitHub Actions + all suites.

## 9. Deployment & migration
1. You create: production Supabase project (EU, Frankfurt `eu-central-1` or Paris `eu-west-3`) and a Cloudflare
   account; you log in to both CLIs when I ask.
2. I apply migrations, configure Auth (sign-ups off, TOTP on, site/redirect URLs), bucket, policies, run the advisors.
3. `scripts/create-owner.ts` invites the first owner by email (you set the password from the email).
4. Seed trips; members import after your OK; then the join form writes to Supabase and Apps Script is deprecated.
5. Deploy with `wrangler deploy`; secrets via `wrangler secret put` (you type them into your terminal).
6. Vercel becomes redirect-only (`vercel-redirect/` with 301 to the same path); you update the Instagram bio.
7. Production smoke test: both languages, a real test reservation on a draft→open test trip (then delete it), admin
   login with MFA, one upload, one export, `curl -I` headers, `/admin` noindex, Lighthouse.

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **10 ms CPU on Workers Free** | Keep SSR light, cache reads, measure CPU in phase 3 (`wrangler tail` shows CPU time); Excel and image work in the browser. Fallback: Workers Paid. |
| R2 | **No edge cache on `*.workers.dev`** (Cache API needs a zone) | In-memory isolate cache on the free subdomain; full edge cache once a custom domain exists. Supabase EU ↔ Cloudflare EU edges are ~20–40 ms apart, so uncached pages stay fast. |
| R3 | **5 GB Supabase egress** | `/media` proxy with immutable caching, three sizes with correct `sizes`, storage meter. R2 option (D3). |
| R4 | **Two free Supabase projects** | Local Docker stack for dev and CI keeps the second slot free (D1). |
| R5 | **Seat races** | Row lock on the trip and a partial unique index; concurrency test with 30 parallel calls. |
| R6 | **Admin account takeover** | MFA enforced in the DB (`aal2` inside `is_admin()`), not just the UI; audit log; owner-only destructive actions. |
| R7 | **Personal data in exports** | Admin-only, logged, formula-safe; privacy page and retention job. |
| R8 | **Sharp doesn't run on Workers** | Only prerendered brand assets use build-time optimisation; trip photos are pre-sized at upload. |
| R9 | **Breaking v1 URLs** | Same slugs for the seeded trips; Vercel 301s to the new host. |
| R10 | **Lighthouse with SSR** | Same lean pages; the poster is the LCP image, preloaded with its `md` size. Re-measured each phase. |

## 11. Phase checklist (each ends with checks, commit, summary)
1. Plan ✅ (this file), **waiting for your OK + D1–D6**
2. Database: migrations, RLS, seat functions, storage, seed, DB tests, advisors clean
3. Cloudflare move: adapter, worker entry, headers/CSP, Turnstile plumbing, site reading from Supabase; v1 tests green
4. Public reservations: upcoming trips, trip form, success, waitlist, status page, copy
5. Admin core: auth + MFA, middleware, overview, trips, reservations, members, admins, audit, settings
6. Images: pipeline, EXIF stripping, sizes, ordering, alt text, public display, `IMAGES.md`
7. Excel: per trip, members, filtered; parse-back tests
8. Jobs & backups: cron, retention, keep-alive, encrypted backup, restore test
9. Deploy & migrate: production, import, Vercel redirect, smoke test
10. Docs & handover: README, ADMIN_GUIDE (EN + Darja), DATA_MODEL, IMAGES, BACKUP_RESTORE, SECURITY, COPY_REVIEW, final report
