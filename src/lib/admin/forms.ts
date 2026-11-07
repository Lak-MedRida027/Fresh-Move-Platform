/** Helpers for admin form posts (POST → 303 redirect back with a flash). */
import type { APIContext } from 'astro';
import type { Locale } from '../../i18n';
import { adminPath, safeBack, withFlash } from './paths';

/** Admin actions all post to /admin/api/…; the page language comes from the form. */
export function formLocale(form: FormData): Locale {
  return form.get('lang') === 'en' ? 'en' : 'ar';
}

export function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export async function readForm(context: APIContext): Promise<FormData> {
  // (CSRF: Astro's checkOrigin rejects cross-site form posts before we get here.)
  const type = context.request.headers.get('content-type') ?? '';
  if (!/multipart\/form-data|application\/x-www-form-urlencoded/.test(type)) return new FormData();
  return context.request.formData();
}

/** Where to go after the action: the form's `back` field, else a default admin page. */
export function backTo(form: FormData, fallback = '/'): string {
  return safeBack(form.get('back'), adminPath(formLocale(form), fallback));
}

export function ok(back: string, code: string, extra?: Record<string, string>): Response {
  let path = withFlash(back, 'ok', code);
  for (const [k, v] of Object.entries(extra ?? {})) path += `&${k}=${encodeURIComponent(v)}`;
  return redirect(path);
}

export function fail(back: string, code: string): Response {
  return redirect(withFlash(back, 'error', code));
}

const KNOWN = new Set([
  'over_capacity',
  'owner_only',
  'invalid_status',
  'forbidden',
  'capacity_below_confirmed',
  'missing_alt_text',
  'last_owner',
  'not_found',
  'invalid_input',
  'too_many_images',
  'trip_not_open',
  'trip_past',
]);

/** Map a database error (our raise codes, or constraint names) to a flash code. */
export function dbErrorCode(error: { message?: string; code?: string } | null): string {
  if (!error) return 'generic';
  if (error.message && KNOWN.has(error.message)) return error.message;
  if (error.code === '23505') return 'slug_taken';
  if (error.message?.includes('trips_bookable_complete')) return 'bookable_incomplete';
  if (error.message?.includes('trips_dates_order')) return 'dates_order';
  if (error.code === '42501') return 'forbidden';
  return 'generic';
}

export const str = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();
export const optStr = (form: FormData, key: string): string | null => str(form, key) || null;
export function intOrNull(form: FormData, key: string): number | null {
  const v = str(form, key);
  return /^-?\d+$/.test(v) ? Number(v) : null;
}

/** 405 for anything but POST on admin action routes. */
export const notAllowed = (): Response => new Response(null, { status: 405, headers: { Allow: 'POST' } });
