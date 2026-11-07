/**
 * Club-wide settings. Edit values here; components read from this file.
 */
export const SITE = {
  name: 'Fresh Move',
  handle: '@fresh_move1',
  /** Fallback only: pages use `Astro.site` (set in astro.config.mjs from Vercel's production URL). */
  url: 'https://freshmove-seven.vercel.app',
} as const;

export const INSTAGRAM = {
  profile: 'https://www.instagram.com/fresh_move1/',
  dm: 'https://ig.me/m/fresh_move1',
} as const;

/** Numbers shown in the "Numbers" section of the home page. */
// TODO(owner): update these from the Instagram profile when they change.
export const STATS = {
  followers: 4611,
  posts: 104,
  destinations: 14, // places listed in the identity file region table
  regions: 5,
} as const;

/** Minimum age to enroll as a member. */
export const MIN_AGE = 18;
export const MAX_AGE = 80;

/**
 * Months after a trip ends before booking details are anonymised (shown on the
 * privacy page). The database setting `settings.retention_months` is what the
 * daily job uses: keep both the same. TODO(owner): confirm 12 months.
 */
export const RETENTION_MONTHS = 12;
