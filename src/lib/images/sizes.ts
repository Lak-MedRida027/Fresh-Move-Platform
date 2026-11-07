/**
 * Photo sizes and storage paths, shared by the browser pipeline, the upload
 * API and the tests. No DOM or server imports.
 */
import { IMAGE_WIDTHS, type ImageSize } from '../media';

export const SIZES = Object.keys(IMAGE_WIDTHS) as ImageSize[];
/** Largest file the admin can pick (before resizing). */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** Photos smaller than this on the long side look bad on the site. */
export const MIN_LONG_SIDE = 320;
/** Largest stored file (the lg size); the bucket limit is 15 MB. */
export const MAX_STORED_BYTES = 15 * 1024 * 1024;
export const WEBP_QUALITY = 0.8;
/** Long side of the inline blurred placeholder. */
export const PLACEHOLDER_SIDE = 16;
export const PLACEHOLDER_MAX_CHARS = 4000;

/** Scale (w, h) down so the long side is at most `long`; never scale up. */
export function fitLongSide(width: number, height: number, long: number): { width: number; height: number } {
  const scale = Math.min(1, long / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Where a photo's three files live (the database enforces the same pattern). */
export function imagePaths(tripId: string, imageId: string): Record<ImageSize, string> {
  return Object.fromEntries(SIZES.map((s) => [s, `trips/${tripId}/${imageId}-${s}.webp`])) as Record<ImageSize, string>;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Dimensions the browser reports for the lg file: whole pixels, long side MIN_LONG_SIDE…1600. */
export function validDimensions(width: unknown, height: unknown): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  const w = width as number;
  const h = height as number;
  const long = Math.max(w, h);
  return w > 0 && h > 0 && long >= MIN_LONG_SIDE && long <= IMAGE_WIDTHS.lg;
}

/** The inline placeholder: a small base64 WebP data URL. */
export function validPlaceholder(p: unknown): p is string {
  return typeof p === 'string' && p.length <= PLACEHOLDER_MAX_CHARS && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(p);
}
