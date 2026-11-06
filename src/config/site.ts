/**
 * Club-wide settings. Edit values here; components read from this file.
 */
export const SITE = {
  name: 'Fresh Move',
  handle: '@fresh_move1',
  /** Production URL. Keep in sync with `site` in astro.config.mjs (SITE_URL env). */
  url: 'https://fresh-move.vercel.app',
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
