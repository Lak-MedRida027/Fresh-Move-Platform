/**
 * Runs for every server-rendered request (static files get the same headers
 * from public/_headers). Adds the security headers, and keeps API and admin
 * responses out of every cache and out of search engines.
 * (Admin authentication is added in this middleware in phase 5.)
 */
import { defineMiddleware } from 'astro:middleware';
import { THEME_INIT_SCRIPT } from './scripts/theme-init';
import { isPrivatePath, securityHeaders } from './lib/security-headers';

let themeHash: Promise<string> | null = null;
function themeScriptHash(): Promise<string> {
  themeHash ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(THEME_INIT_SCRIPT))
    .then((buf) => btoa(String.fromCharCode(...new Uint8Array(buf))));
  return themeHash;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  // Prerendered pages are served as static files with public/_headers.
  if (context.isPrerendered) return response;

  const headers = securityHeaders({
    themeScriptHash: await themeScriptHash(),
    supabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL,
  });
  // Some responses (e.g. from fetch) have immutable headers: copy them.
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  if (isPrivatePath(context.url.pathname)) {
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return out;
});
