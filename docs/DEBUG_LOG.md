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
