/**
 * Per-request Supabase client for the admin (cookie session via @supabase/ssr).
 * Uses the PUBLISHABLE key: every query runs as the signed-in admin, so the
 * database's RLS + is_admin() (which requires MFA) decide what's allowed.
 * Session cookies are httpOnly (no page script can read them), SameSite=Lax,
 * Secure on HTTPS.
 */
import type { AstroCookies } from 'astro';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

export type AdminClient = SupabaseClient<Database>;

export function supabaseServer(request: Request, cookies: AstroCookies): AdminClient {
  const secure = new URL(request.url).protocol === 'https:';
  return createServerClient<Database>(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure, path: '/' },
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get('cookie') ?? '').map((c) => ({ name: c.name, value: c.value ?? '' })),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          cookies.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure, path: '/' });
        }
      },
    },
  });
}
