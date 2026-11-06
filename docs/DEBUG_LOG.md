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
