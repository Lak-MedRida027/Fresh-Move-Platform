import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from '../../src/scripts/theme-init';
import { buildCsp, isPrivatePath, needsWasm, securityHeaders } from '../../src/lib/security-headers';

const hash = createHash('sha256').update(THEME_INIT_SCRIPT).digest('base64');
const SUPABASE = 'https://abcd.supabase.co';
const headers = securityHeaders({ themeScriptHash: hash, supabaseUrl: SUPABASE });

describe('security headers', () => {
  it('CSP allows only the theme bootstrap inline, plus Turnstile and Supabase', () => {
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain(`script-src 'self' 'sha256-${hash}' https://challenges.cloudflare.com`);
    expect(csp).toContain(`img-src 'self' data: blob: ${SUPABASE}`);
    expect(csp).toContain(`connect-src 'self' ${SUPABASE}`);
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("style-src 'self'");
    // Nothing else is allowed to load scripts or frames.
    const origins = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect([...new Set(origins)].sort()).toEqual(['https://abcd.supabase.co', 'https://challenges.cloudflare.com']);
  });

  it('uses only the origin of the Supabase URL', () => {
    expect(buildCsp({ themeScriptHash: hash, supabaseUrl: 'https://abcd.supabase.co/rest/v1/' })).toContain(
      `connect-src 'self' https://abcd.supabase.co;`,
    );
  });

  it('allows WebAssembly (not eval) only on the admin photos page', () => {
    const id = '0b7f3c52-6a8e-4c1e-9d2a-3f4b5c6d7e8f';
    expect(needsWasm(`/admin/trips/${id}/photos/`)).toBe(true);
    expect(needsWasm(`/en/admin/trips/${id}/photos/`)).toBe(true);
    for (const p of ['/', '/trips/x/', `/admin/trips/${id}/`, '/admin/', `/admin/trips/${id}/photos/x`]) {
      expect(needsWasm(p), p).toBe(false);
    }
    const csp = buildCsp({ themeScriptHash: hash, supabaseUrl: SUPABASE, allowWasm: true });
    expect(csp).toContain(`script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'`);
    expect(csp.replace("'wasm-unsafe-eval'", '')).not.toContain('unsafe-eval');
  });

  it('sets the other required headers', () => {
    expect(headers['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });

  it('admin and API paths are private (noindex, no-store)', () => {
    for (const p of ['/admin', '/admin/', '/admin/trips/1', '/en/admin/', '/api/join']) expect(isPrivatePath(p), p).toBe(true);
    for (const p of ['/', '/trips/', '/administrator-tips/', '/en/trips/x/']) expect(isPrivatePath(p), p).toBe(false);
  });

  it('public/_headers is generated from the same source (run npm run build if this fails)', () => {
    const file = readFileSync('public/_headers', 'utf8');
    expect(file).toContain(`'sha256-${hash}'`);
    expect(file).toContain('https://challenges.cloudflare.com');
    expect(file).toContain("frame-ancestors 'none'");
  });
});
