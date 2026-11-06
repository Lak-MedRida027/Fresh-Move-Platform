# Adding a trip (or real photos)

No coding needed. You copy one file, change the text, add photos, and push to GitHub.
Vercel rebuilds the site automatically in about 2 minutes.

## What a trip is made of

```
src/content/trips/<slug>.md         ← the trip's text (both languages)
src/assets/trips/<slug>/cover.jpg   ← the main photo
src/assets/trips/<slug>/01.jpg …    ← gallery photos
```

`<slug>` is the trip's short name for the web address, in lowercase with dashes, e.g. `tikjda-winter-camp`.
The page will be at `/trips/tikjda-winter-camp/` and `/en/trips/tikjda-winter-camp/`.

## Step by step (on github.com, no software needed)

1. Open the repository on GitHub and go to `src/content/trips/`.
2. Open an existing trip, e.g. `chelia-summit.md`, and copy everything in it (the ✏️ edit view → select all → copy).
3. Go back to `src/content/trips/`, click **Add file → Create new file**, name it `<slug>.md`
   (e.g. `tikjda-winter-camp.md`), paste, and edit the values:

```yaml
---
slug: tikjda-winter-camp            # must be exactly the file name without .md
title:
  ar: "كامبينغ تيكجدة"               # Darja title
  en: "Tikjda winter camp"           # English title
region: kabylie-north-coast          # one of: aures, kabylie-north-coast, northeast-coast, sahara, babors
terrain: [camping, mountain]         # any of: mountain, desert, coast, camping, heritage, diving (first = main color)
date: '2026-12'                      # year-month of the trip, or 'TBD'
summary:
  ar: "جملة ولا جوج بالدارجة على الخرجة."
  en: "One or two sentences about the trip."
cover: ../../assets/trips/tikjda-winter-camp/cover.jpg
gallery:
  - ../../assets/trips/tikjda-winter-camp/01.jpg
  - ../../assets/trips/tikjda-winter-camp/02.jpg
instagramPostUrl: https://www.instagram.com/p/XXXXXXXX/   # optional: delete the line if none
featured: false                      # true = show on the home page (keep exactly 6 featured trips)
---
```

4. Click **Commit changes**.
5. Add the photos. On your computer, make a folder named exactly like the slug (`tikjda-winter-camp`)
   and put the photos in it, renamed `cover.jpg`, `01.jpg`, `02.jpg`… Then on GitHub go to
   `src/assets/trips/`, click **Add file → Upload files**, and **drag the whole folder** onto the page
   (Chrome / Edge keep the folder). Click **Commit changes**.
6. Vercel builds and publishes the new trip. Check it at `/trips/<slug>/`.

Tip: do steps 3–5 in one go. If you commit the trip file before the photos, that first build fails
(photos missing), which is harmless: the next commit fixes it.

## Photo tips

- JPG or PNG, landscape, at least **1600 px wide**. Big files are fine: the site makes small, fast versions
  automatically (AVIF/WebP, several sizes).
- The cover appears behind white text with a dark gradient, so pick a photo where the **bottom part
  isn't too bright**.
- Up to ~12 gallery photos per trip is a good amount.
- Only use photos the club owns or has permission to use.

## Replacing a placeholder photo with a real one

The current photos are generated placeholders. To replace one, upload a real photo with **exactly the
same name** into the same folder (e.g. `src/assets/trips/chelia-summit/cover.jpg`), and GitHub will
replace it. The hero image on the home page is `src/assets/hero/hero.jpg`.

Then update the alt text if needed: the site currently adds "(placeholder photo)" to photo descriptions.
Once all photos are real, edit `trip.coverAlt`, `trip.photoAlt` and `hero.imageAlt` in
`src/i18n/ar.json` and `src/i18n/en.json` to remove that part.

## If the build fails

Vercel shows a red ❌ on the commit. The most common causes:

| Error mentions | Fix |
|---|---|
| `slug` | The slug isn't lowercase-with-dashes, or it doesn't match the file name. |
| `region` / `terrain` | A value that's not in the allowed list (check spelling). |
| `date` | Must be `'YYYY-MM'` (with quotes) or `'TBD'`. |
| `Could not find requested image` | The photo path or file name doesn't match (check `.jpg` vs `.jpeg`, capital letters). |
| `title` / `summary` | One of the two languages is missing. |

The live site keeps showing the last good version until the error is fixed, so nothing breaks for visitors.

## Other things you can edit the same way

| What | File |
|---|---|
| Follower / post numbers on the home page | `src/config/site.ts` (`STATS`) |
| Minimum age for the form | `src/config/site.ts` (`MIN_AGE`), and `MIN_AGE` in `apps-script/Code.gs` |
| Any text on the site | `src/i18n/ar.json` (Darja) and `src/i18n/en.json` (English): same keys in both |
| Regions and destination names | `src/data/regions.ts` |
| Logo | replace `public/brand/logo.jpg` (or add `logo.png`), then run `npm run icons` and `node scripts/make-og.mjs` |
