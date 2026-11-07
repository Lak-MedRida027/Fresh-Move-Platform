/**
 * Runs for every server-rendered request (static files get the same headers
 * from public/_headers):
 *  1. Admin guard for /admin and /en/admin: session (verified with Supabase
 *     Auth), inactivity timeout, MFA (aal2) and the admin role from the
 *     database. Pages redirect to login; /admin/api/* answers 401/403.
 *  2. Security headers; API and admin responses are never cached or indexed.
 */
import type { APIContext, MiddlewareNext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { THEME_INIT_SCRIPT } from './scripts/theme-init';
import { isPrivatePath, needsWasm, securityHeaders } from './lib/security-headers';
import { ADMIN_MFA, ADMIN_PUBLIC, ADMIN_RE, adminLocale, adminPath } from './lib/admin/paths';
import { supabaseServer } from './lib/supabase/server';

export const ADMIN_IDLE_MS = 2 * 60 * 60 * 1000; // sign out after 2 h without activity
const SEEN_COOKIE = 'fm_admin_seen';
const OWNER_ONLY = /^\/(en\/)?admin\/(admins|audit|settings)(\/|$)|^\/admin\/api\/(admins|settings)\/?$/;

let themeHash: Promise<string> | null = null;
function themeScriptHash(): Promise<string> {
  themeHash ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(THEME_INIT_SCRIPT))
    .then((buf) => btoa(String.fromCharCode(...new Uint8Array(buf))));
  return themeHash;
}

const deny = (status: 401 | 403, isApi: boolean, location: string) =>
  isApi
    ? new Response(JSON.stringify({ ok: false, error: status === 401 ? 'unauthorized' : 'forbidden' }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    : new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });

async function guardAdmin(context: APIContext, next: MiddlewareNext): Promise<Response> {
  const { pathname } = context.url;
  if (!ADMIN_RE.test(pathname) || context.isPrerendered || ADMIN_PUBLIC.test(pathname)) return next();

  const locale = adminLocale(pathname);
  const isApi = /\/admin\/api\//.test(pathname);
  const login = adminPath(locale, '/login/');
  const supabase = supabaseServer(context.request, context.cookies);

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return deny(401, isApi, login);

  // Inactivity timeout.
  const seen = Number(context.cookies.get(SEEN_COOKIE)?.value ?? '0');
  if (seen && Date.now() - seen > ADMIN_IDLE_MS) {
    await supabase.auth.signOut();
    context.cookies.delete(SEEN_COOKIE, { path: '/' });
    return deny(401, isApi, `${login}?expired=1`);
  }
  context.cookies.set(SEEN_COOKIE, String(Date.now()), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: context.url.protocol === 'https:',
  });

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Already verified: the MFA page has nothing to do.
  if (aal?.currentLevel === 'aal2' && /^\/(en\/)?admin\/mfa\/?$/.test(pathname)) {
    return new Response(null, { status: 303, headers: { Location: adminPath(locale, '/'), 'Cache-Control': 'no-store' } });
  }
  if (aal?.currentLevel !== 'aal2') {
    // Signed in with a password only: the MFA page (enrol or verify) and logout.
    const { data: pending } = await supabase.rpc('is_admin_pending_mfa');
    if (!pending) return deny(403, isApi, `${login}?error=not_admin`);
    if (!ADMIN_MFA.test(pathname)) return deny(401, isApi, adminPath(locale, '/mfa/'));
    context.locals.pendingMfa = { supabase, userId: user.id, email: user.email ?? '' };
    return next();
  }

  const { data: role } = await supabase.rpc('admin_role');
  if (role !== 'owner' && role !== 'organizer') return deny(403, isApi, `${login}?error=not_admin`);
  // Owner-only pages (the database enforces the same with RLS).
  if (role !== 'owner' && OWNER_ONLY.test(pathname)) {
    return isApi ? deny(403, true, '') : new Response(null, { status: 303, headers: { Location: `${adminPath(locale, '/')}?error=owner_only`, 'Cache-Control': 'no-store' } });
  }
  context.locals.admin = { supabase, userId: user.id, email: user.email ?? '', role };
  return next();
}

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await guardAdmin(context, next);
  // Prerendered pages are served as static files with public/_headers.
  if (context.isPrerendered) return response;

  const headers = securityHeaders({
    themeScriptHash: await themeScriptHash(),
    supabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL,
    allowWasm: needsWasm(context.url.pathname),
  });
  // Some responses have immutable headers: copy them.
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  if (isPrivatePath(context.url.pathname)) {
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return out;
});
