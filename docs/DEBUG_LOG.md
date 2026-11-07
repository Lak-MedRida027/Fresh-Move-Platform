# Debug log

Notable bugs found while building the site: symptom, cause, fix.

## Astro inlined the site script, which the CSP would block
- **Symptom:** the built HTML had a `<script type="module">` with the theme/menu code inlined.
- **Cause:** Astro inlines small bundled scripts (below Vite's `assetsInlineLimit`).
- **Fix:** `vite.build.assetsInlineLimit: 0` in `astro.config.mjs`. Every script is now an external file
  and the CSP only allows the theme bootstrap by hash. `tests/e2e/basics.spec.ts` fails on any CSP error.

## Theme bootstrap hash must match the CSP
- **Risk:** editing the inline theme script without updating `vercel.json` would silently break the theme.
- **Fix:** the script lives in one string (`src/scripts/theme-init.ts`); `tests/unit/csp.test.ts` hashes it
  and fails if `vercel.json` doesn't contain the same `sha256-…`.

## WebKit upgraded `http://localhost` to HTTPS
- **Symptom:** Safari e2e tests failed with "SSL connect error" for every asset.
- **Cause:** the CSP had `upgrade-insecure-requests`; WebKit applies it to localhost (Chromium doesn't).
- **Fix:** removed the directive. The site loads nothing cross-origin and HSTS already forces HTTPS, so it
  added nothing in production.

## Safari logged 404s for favicon / manifest
- **Symptom:** "no console errors" e2e tests failed only on WebKit.
- **Cause:** `<link rel="icon">` / manifest pointed at files not generated yet.
- **Fix:** `scripts/make-icons.mjs` builds the icon set from `public/brand/logo.*`.

## `localStorage` throws in in-app browsers
- **Fix:** every read/write is wrapped in try/catch (inline bootstrap and `src/scripts/site.ts`);
  e2e test "works when localStorage throws" replaces `localStorage` with a throwing getter.

## Content collections are empty under Vitest
- **Symptom:** `getCollection('trips')` returned `[]` in unit tests.
- **Cause:** Astro's content loaders only run inside `astro build/dev/sync`, not in Vitest.
- **Fix:** the schema lives in `src/lib/trip-schema.ts` and is shared: `content.config.ts` passes Astro's
  `image()` helper, the unit test reads the Markdown frontmatter and checks image files exist.

## One 404 page for every language on Vercel
- **Cause:** Vercel serves the root `404.html` for every missing URL, including `/en/...`.
- **Fix:** the 404 page shows both languages (Darja first, English block below). `/en/404/` still exists
  for the language switch. The local test server (`scripts/serve-dist.mjs`) mirrors this behaviour.

## Two client scripts both declared `items`
- **Cause:** a `.ts` file without imports/exports is a global script for TypeScript.
- **Fix:** `export {}` in `src/scripts/lightbox.ts` and `src/scripts/trip-filters.ts`.

## Empty error badges showed on every form field
- **Symptom:** e2e "phone error disappears once fixed" failed; every field had a red "!" under it.
- **Cause:** `.field__error { display: flex }` overrides the browser's `[hidden] { display: none }`.
- **Fix:** global `[hidden] { display: none !important; }` in `global.css`, so component display rules can
  never un-hide hidden elements.

## Two elements matched `[data-failure]`
- **Cause:** the form carried its failure message in a `data-failure` attribute, the same name as the
  failure box's hook.
- **Fix:** renamed the attribute to `data-failure-message`.

## Build output moved when the server route was added
- **Cause:** with an on-demand route, Astro writes static files to `dist/client/` instead of `dist/`.
- **Fix:** `scripts/serve-dist.mjs` serves `.vercel/output/static`, exactly what Vercel serves.

## Shell escaping ate a regex backslash
- **Symptom:** 15 phone tests failed after a lint fix.
- **Cause:** `sed` turned ` ` into `00A0` inside the character class, so zeros were stripped.
- **Fix:** removed it (`\s` already matches no-break spaces); the unit tests caught it immediately.

## Wilaya list changed in 2026
- Algeria went from 58 to 69 wilayas (law 26-06 of 4 April 2026; numbering decree in JO n° 40, June 2026).
  `src/data/wilayas.ts` has all 69 with the sources noted; a unit test checks there are 69 unique entries.

## Home page Lighthouse performance 85 (target ≥ 90)
- **Measured:** mobile Lighthouse, LCP 3.8 s, TBT 220 ms, 1.2 s of style/layout/paint on the main thread.
- **Causes and fixes:**
  1. `backdrop-filter: blur()` on the sticky header and photo buttons (repainted on every scroll frame):
     replaced with solid backgrounds.
  2. `text-wrap: pretty` on every paragraph (expensive line breaking): removed; headings keep `balance`.
  3. Six render-blocking CSS files per page: `vite.build.cssCodeSplit: false` → one 38 KB stylesheet
     (~7 KB compressed).
  4. Preloading four font files competed with the hero image: preload only the headline weight per language.
  5. The local test server didn't compress like Vercel does: added brotli/gzip so measurements are realistic.
- **Result:** median of 3 runs: 92–96 performance; 100 accessibility / best practices / SEO.
  TBT 220 ms → ~10 ms. Run `npm run lighthouse` to re-measure.

## axe: decorative numbers below 3:1 contrast
- **Symptom:** `color-contrast` (serious) on the "01–05" numbers in the personality cards.
- **Fix:** coloured with `--fg-muted` (≥ 3:1, the large-text threshold) instead of `--border`.
  We fixed the colour rather than hiding the numbers from the checker.

## Brand link in the header was 40 px wide on small phones
- **Fix:** `min-inline-size: 44px` (the e2e "touch targets" test checks every interactive element ≥ 44 px).

## OG image rendered with fallback fonts
- **Cause:** a `page.setContent()` page can't load `file://` fonts.
- **Fix:** `scripts/make-og.mjs` inlines the woff2 files as data URIs and fails if `document.fonts.check()` is false.

## Security review of /api/join (after first push)
An automated review flagged three weaknesses; all fixed with tests in `tests/api/join.test.ts`:
1. **Rate-limit key from a spoofable header.** The limiter used the first `X-Forwarded-For` entry, which a
   client can set. Now it uses Astro's `clientAddress` (from Vercel's edge) first, then `x-real-ip`, then
   only the last, proxy-appended `X-Forwarded-For` entry.
2. **Size limit checked after buffering.** A chunked body with no `Content-Length` was read in full
   before the 4 KB check. Now the body is streamed and reading stops at 4 KB (413).
3. **Limiter cleared all counters when full.** Reaching 5,000 keys wiped every counter (fail open).
   Now only expired keys are evicted, and if it's still full of live keys new keys are refused.

## Live Lighthouse home score swung between 79 and 99
- **Measured:** 3-run medians on the live site gave 79–84 for the home page (TBT 500–800 ms), while a
  single run moments later gave 99 / TBT 0 ms.
- **Cause:** Lighthouse simulates a slow phone by multiplying the CPU time it observes; runs made while
  the machine was busy (e2e suite just before) inflated TBT. Re-measured with 5 runs on an idle machine:
  93 / 98 / 98 / 99.
- **Tried and reverted:** `content-visibility: auto` on home sections cut layout work, but made the hero's
  "Join the club" anchor land short of the form on phones (the browser only estimates skipped sections'
  heights). The e2e test "hero CTA scrolls to it" caught it. A working CTA beats a few Lighthouse points.

## e2e suite runs against the live site
- `BASE_URL=https://freshmove-seven.vercel.app npx playwright test` runs every e2e + axe test against a
  deployment (no local server). One test had a `localhost` regex; it now checks the pathname instead.

---

# v2

## Audit trigger failed on every table except admin_users
- **Symptom:** 8 DB tests failed with `42703` / `record "new" has no field "user_id"`.
- **Cause:** the shared audit trigger had `CASE WHEN tg_table_name = 'admin_users' THEN new.user_id …`.
  PL/pgSQL resolves record fields when the expression is prepared, even in branches that don't run.
- **Fix:** read the id through `to_jsonb(new) ->> 'id'` / `->> 'user_id'`, which works for any table.

## "permission denied for schema private" when an admin edited a trip
- **Cause:** trigger functions run as the calling user; the guard trigger called a helper in schema
  `private`, which `authenticated` can't use (on purpose).
- **Fix:** the internal trigger functions are `SECURITY DEFINER` with `search_path = ''`. The schema stays
  closed to API roles.

## Concurrency test failed right after `supabase db reset`
- **Symptom:** the 30-parallel-bookings test failed about 1 in 4 times, only on the first run after a
  reset. The error detail showed `57P01 terminating connection due to unexpected postmaster exit` /
  `PGRST001 no connection to the server`, never a wrong seat count.
- **Investigation:** reproduced with a reset → test loop (9/12 passed). The database container wasn't
  OOM-killed and didn't restart. Its log shows `db reset` doing a fast shutdown + restart about 1 s after the
  command returns, so the first requests can hit that restart.
- **Fix (root cause is test start-up timing):** `scripts/with-local-supabase.mjs` waits until the API answers
  three times in a row before running tests. After the fix: 10/10 runs pass, each straight after a reset.

## plpgsql_check: STABLE function calling a VOLATILE one
- `private.require_admin()` (and `admin_storage_usage()`) were `STABLE` but can raise; marked volatile.
  `npm run db:lint` (lint + Security/Performance Advisors) now reports no issues, and CI fails on any finding.

## Phase 3: moving to Cloudflare Workers

- **Unknown trip slug returned 500.** `Astro.rewrite('/404/')` from an on-demand page to a prerendered
  404 isn't supported. Fix: the trip route renders the 404 view itself with `Astro.response.status = 404`.
  e2e checks both languages return 404 (not 500).
- **Unit tests failed to start (`exports is not defined`).** `getViteConfig()` loaded the Cloudflare
  adapter's workerd test runner. The tests don't need Astro's virtual modules any more, so they use a
  plain Vitest config.
- **Browser scripts stopped type-checking.** `wrangler types` emits the whole Workers runtime as globals,
  which replace DOM types. Now `wrangler types --include-runtime=false` (bindings only) plus the few
  runtime types we use in `src/cloudflare.d.ts`.
- **Headers:** Cloudflare's `_headers` file doesn't apply to responses from the Worker, so headers are
  defined once (`src/lib/security-headers.ts`) and applied by middleware (on-demand pages) and written to
  `public/_headers` before each build (static files).
- **Lighthouse on the local preview looked like a regression (75–91).** `astro preview` doesn't compress
  (home HTML 66 KB vs ~9 KB with brotli; Cloudflare compresses in production). Measured through
  `scripts/compress-proxy.mjs`: 90 / 95 / 93 / 95 performance, 100 for the rest.
- **Secrets:** the build copies `.dev.vars` into `dist/server/.prerender/` for prerendering. A post-build
  check (`scripts/check-client-secrets.mjs`) fails the build if any server-only key name or value appears
  in `dist/client` (what browsers can download).

## Phase 4: public reservations

- **Reservations never succeeded in e2e.** Reproduced with curl against workerd: the API answered
  `name.invalid`. The test names ("E2E Tester") contain a digit, which the shared name rule rightly rejects.
  Fixed the test data (letter-only names), not the rule.
- **No seats badge on the trip page.** The route still used `getTripBySlug` (no seat count) instead of
  `getTripWithSeats`. Caught by the e2e reservation test.
- **Prices failed axe contrast in light theme.** Desert Gold `#A08548` is 3.5:1 on white and the price
  isn't "bold large text". Added `--sand-text` (`#7A6534`, 5.6:1) for small gold text in light theme.
- **Every dark-theme page failed axe after a rebuild.** Not a CSS bug: a preview server started by hand
  before the rebuild kept serving the old build's stylesheet list (one 404), and Playwright reused it.
  Same cause for stale trips: that server's 60 s in-memory cache still held trips the fixtures had
  recreated. Lesson: let Playwright start its own server after the fixtures.
- **"Not found" test hit the rate limiter.** Every run checked the same fake code, so the per-code limit
  (10/hour) kicked in across repeated runs. That's the limiter working; the test now uses a random code and
  the e2e fixtures reset the local `rate_limits` table.
- **Meeting time rendered in the wrong place in RTL** (`06:30محطة باتنة ·`). The time is now on its own line
  inside `<bdi dir="ltr">`.
- **Known, for phase 6:** with an on-demand server build, Astro emits one stylesheet per build environment,
  so pages link two CSS files that share the base styles (~20 KB raw duplicated). Works; to optimise later.
