# Trip photos

How photos get from a phone to the site, and the rules they follow.

## For the team (how to add photos)

1. Admin → **Trips** → the trip → **Photos**.
2. Pick the type: **Poster** (the announcement image, for upcoming trips) or **Gallery** (photos from the
   trip, shown once it's completed).
3. Tap **Choose photos** and pick one or more. Each one shows a progress bar. Nothing to resize first:
   phone photos are fine as they are (up to 40 MB each; JPEG, PNG, WebP, and HEIC where the browser can
   open it, which means Safari on iPhone).
4. Write a short **description** for each photo in **Darja and English**: what's in it, for people who
   can't see it ("Group at the summit of Chélia at sunrise"). A trip can't be published, closed or marked
   completed while a photo is missing one, and the public never sees a photo without both.
5. Choose the **cover** (the image on trip cards and at the top of the trip page) and the **order** with
   *Move up* / *Move down*.
6. **Delete** is under *More* on each photo. It removes the photo and its files for good.

The photos page and the overview show how much storage is used. At 80 % of the 1 GB plan, a warning
appears: delete photos you don't need, or move to a bigger plan.

## What happens to a photo

All the image work happens in the admin's browser (`src/lib/images/pipeline.ts`); the server never
touches the pixels. Workers Free has a 10 ms CPU limit per request and can't run image libraries.

1. **Decode** with `createImageBitmap(file, { imageOrientation: 'from-image' })`, so a photo taken
   sideways (EXIF orientation) comes out upright. If that fails (HEIC on some browsers), it tries an
   `<img>` element, then gives a clear error.
2. **Resize** to three sizes, by the long side: **sm 480**, **md 960**, **lg 1600** px. Never upscaled.
   The largest is drawn from the original, the two smaller ones from it, so no canvas is bigger than
   1600 px (phones run out of canvas memory with 48 MP photos).
3. **Encode WebP** at quality 0.8 with `canvas.toBlob`. Browsers that can't write WebP from a canvas
   (it silently returns PNG) load a WebAssembly encoder ([`@jsquash/webp`](https://github.com/jamsinclair/jSquash),
   ~300 KB, admin photos page only, loaded only when needed).
4. **Placeholder:** a 16 px WebP as a base64 data URL (~100–300 bytes), shown blurred while the real
   image loads.
5. **Metadata is gone.** The files are written from canvas pixels, so nothing from the original
   survives: no EXIF, no GPS location, no camera details, no XMP. The e2e test uploads a JPEG with GPS
   and camera EXIF and checks that the stored files have none.

## Upload

`src/scripts/admin-photos.ts` → `/admin/api/photos/` (`src/pages/admin/api/photos.ts`):

1. `prepare`: the server (as the signed-in admin, so RLS applies) creates the image id and one **signed
   upload URL** per size. Gallery photos are checked against the per-trip limit (`settings.max_gallery_images`).
2. The browser uploads the three files **straight to Supabase Storage** with `XMLHttpRequest` (for the
   progress bar). Photo bytes never go through the Worker.
3. `register`: the server lists the files in storage and checks all three are there, are `image/webp`
   and are under 15 MB, then adds the `trip_images` row with the real total size. If anything is wrong,
   it deletes the files.
4. `abort`: if an upload fails part-way, the browser asks the server to delete what was uploaded.

The JSON endpoint only accepts same-origin requests (the `Origin` header must match). The per-photo
actions (save, cover, move, delete) are plain form posts with the usual CSRF check.

## Storage

- Bucket **`trip-images`**: public read (by URL), 15 MB per file, `image/webp` only. Only admins (with
  MFA) can upload, change or delete (storage policies in `supabase/migrations/20261107000300_security.sql`).
- Paths: `trips/<trip-id>/<image-id>-{sm,md,lg}.webp`. The database enforces this pattern
  (`trip_images_paths` check), so deleting a photo or a trip always finds the files.
- Files are uploaded with `Cache-Control: max-age=31536000`. A photo's path never changes (a new photo
  gets a new id), so caches never serve a stale image.
- **Deleting a photo** deletes the row, then its three files. **Deleting a trip** deletes the rows
  (cascade), then everything under `trips/<trip-id>/`. If a file can't be deleted, the error is logged;
  the file no longer appears anywhere.

## On the site

- `srcset` with the three sizes and their real widths (`src/lib/media.ts`), so phones download the 480 or
  960 version. The poster on a trip page is the LCP image and loads with `fetchpriority="high"`.
- Alt text comes from the photo's description in the page's language.
- Photos of draft trips, and photos without both descriptions, aren't returned to the public at all
  (row-level security on `trip_images`).

## Limits and numbers

| What | Value | Where |
| --- | --- | --- |
| Largest file you can pick | 40 MB | `MAX_INPUT_BYTES`, `src/lib/images/sizes.ts` |
| Smallest photo | 320 px on the long side | `MIN_LONG_SIDE` |
| Stored sizes | 480 / 960 / 1600 px (long side), WebP 0.8 | `IMAGE_WIDTHS`, `WEBP_QUALITY` |
| Largest stored file | 15 MB (bucket limit) | storage bucket, `MAX_STORED_BYTES` |
| Gallery photos per trip | 60 (owner can change it) | Admin → Settings |
| Storage plan | 1 GB (Supabase Free); warning at 80 % | `admin_storage_usage()` |

A typical phone photo ends up around 250–450 KB for all three sizes together, so 1 GB holds roughly
2,500–4,000 photos.

## Tests

- `tests/unit/images.test.ts`: sizes, paths, upload validation.
- `tests/db/rls.test.ts`: path pattern, public visibility needs both descriptions, publishing and closing
  need them, reorder function.
- `tests/e2e/admin.spec.ts` (photos): uploads a rotated JPEG with GPS EXIF, a large PNG and a too-small
  image in all three browsers; checks the stored WebP files (sizes, no metadata), the alt-text gate,
  cover, order, delete (files gone) and trip delete (folder empty); forces the WebAssembly encoder; checks
  the API refuses cross-origin requests and photos whose files aren't in storage.
