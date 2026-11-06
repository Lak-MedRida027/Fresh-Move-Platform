import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from '../../src/scripts/theme-init';

type VercelConfig = { headers: { source: string; headers: { key: string; value: string }[] }[] };
const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig;
const all = config.headers.find((h) => h.source === '/(.*)')?.headers ?? [];
const header = (key: string) => all.find((h) => h.key === key)?.value ?? '';

describe('security headers (vercel.json)', () => {
  it('CSP allows the theme bootstrap by its exact SHA-256 hash', () => {
    const hash = createHash('sha256').update(THEME_INIT_SCRIPT).digest('base64');
    expect(header('Content-Security-Policy')).toContain(`'sha256-${hash}'`);
  });

  it('CSP has no unsafe-inline / unsafe-eval and blocks framing', () => {
    const csp = header('Content-Security-Policy');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('sets the other required headers', () => {
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d{7,}/);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Permissions-Policy')).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });
});
