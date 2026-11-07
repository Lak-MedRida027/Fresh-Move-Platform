/**
 * Security headers, defined once. Applied by src/middleware.ts to every
 * server-rendered response, and written to public/_headers (by
 * scripts/write-headers.ts) for static files, because Cloudflare's _headers
 * file does not apply to responses produced by the Worker.
 *
 * No imports on purpose: the Node script loads this file directly.
 */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export interface CspOptions {
  /** base64 SHA-256 of the inline theme bootstrap (the only inline script). */
  themeScriptHash: string;
  /** Supabase project URL (images, admin uploads and auth). */
  supabaseUrl: string;
}

export function buildCsp({ themeScriptHash, supabaseUrl }: CspOptions): string {
  const supabase = new URL(supabaseUrl).origin;
  return [
    "default-src 'self'",
    `script-src 'self' 'sha256-${themeScriptHash}' ${TURNSTILE_ORIGIN}`,
    "style-src 'self'",
    `img-src 'self' data: blob: ${supabase}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function securityHeaders(opts: CspOptions): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(opts),
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
}

/** Paths that must never be indexed or cached. */
export function isPrivatePath(pathname: string): boolean {
  return /^\/(en\/)?admin(\/|$)/.test(pathname) || pathname.startsWith('/api/');
}
