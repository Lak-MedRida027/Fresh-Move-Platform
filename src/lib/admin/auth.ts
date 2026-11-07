/** Rules for the admin account pages (email links, passwords). Pure: unit-tested. */

/** Email link types this site handles (Supabase templates link to /admin/auth/confirm/). */
export const LINK_TYPES = ['invite', 'recovery'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export function linkType(value: unknown): LinkType | null {
  return LINK_TYPES.includes(value as LinkType) ? (value as LinkType) : null;
}

/** Supabase's token hash (hex today); anything else is refused before any call. */
export function validTokenHash(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(value);
}

export const MIN_PASSWORD = 12;

/** Flash code for a password that can't be used, or null. */
export function passwordProblem(password: string, repeat: string, email = ''): 'pw_short' | 'pw_mismatch' | 'pw_weak' | null {
  if (password.length < MIN_PASSWORD || password.length > 200) return 'pw_short';
  if (password !== repeat) return 'pw_mismatch';
  const name = email.split('@')[0]?.toLowerCase() ?? '';
  const lower = password.toLowerCase();
  if ((name.length >= 3 && lower.includes(name)) || /^(.)\1+$/.test(password) || /fresh ?move|password|123456/.test(lower)) return 'pw_weak';
  return null;
}
