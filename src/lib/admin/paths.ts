/** Admin URL helpers. Darja admin at /admin/…, English at /en/admin/…. */
import type { Locale } from '../../i18n';

export const ADMIN_RE = /^\/(en\/)?admin(\/|$)/;
/** No session needed: sign in, the email link landing page (invite / reset), "forgot password". */
export const ADMIN_PUBLIC = /^\/(en\/)?admin\/(login|api\/login|auth\/confirm|api\/confirm|forgot|api\/forgot)\/?$/;
/**
 * Reachable with a password-only (aal1) session: MFA, sign out, and choosing a
 * password. The password page sends anyone who already has MFA through the
 * code first (Supabase refuses the change otherwise: insufficient_aal).
 */
export const ADMIN_MFA = /^\/(en\/)?admin\/(mfa|api\/mfa|api\/logout|password|api\/password)\/?$/;

export function adminLocale(pathname: string): Locale {
  return pathname.startsWith('/en/') ? 'en' : 'ar';
}

export function adminPath(locale: Locale, path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${locale === 'en' ? '/en' : ''}/admin${clean}`;
}

/** Only allow redirects back into the admin (no open redirects). */
export function safeBack(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  if (!/^\/(en\/)?admin(\/[\w\-/]*)?\/?(\?[\w=&%.-]*)?$/.test(value)) return fallback;
  return value;
}

/** Adds ?ok= / ?error= flash parameters to a path. */
export function withFlash(path: string, kind: 'ok' | 'error', code: string): string {
  const url = new URL(path, 'http://x');
  url.searchParams.delete('ok');
  url.searchParams.delete('error');
  url.searchParams.set(kind, code);
  return `${url.pathname}${url.search}`;
}
