/**
 * Trip photo URLs. Photos are stored pre-sized in Supabase Storage
 * (bucket trip-images): sm 480, md 960, lg 1600 px on the long side.
 */
export const IMAGE_WIDTHS = { sm: 480, md: 960, lg: 1600 } as const;
export type ImageSize = keyof typeof IMAGE_WIDTHS;

export function storageUrl(path: string, base = import.meta.env.PUBLIC_SUPABASE_URL ?? ''): string {
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/trip-images/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

export interface Sized {
  width: number;
  height: number;
  path_sm: string;
  path_md: string;
  path_lg: string;
}

/** srcset for an image stored in three sizes (width descriptors scaled to its aspect). */
export function srcset(img: Sized, base?: string): string {
  const long = Math.max(img.width, img.height);
  const w = (target: number) => Math.round((img.width * Math.min(target, long)) / long);
  return [
    `${storageUrl(img.path_sm, base)} ${w(IMAGE_WIDTHS.sm)}w`,
    `${storageUrl(img.path_md, base)} ${w(IMAGE_WIDTHS.md)}w`,
    `${storageUrl(img.path_lg, base)} ${img.width}w`,
  ].join(', ');
}
