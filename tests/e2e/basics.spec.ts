import { expect, test, type Page } from '@playwright/test';

/** Collect CSP violations and page errors so tests fail if the CSP breaks something. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test.describe('language and direction', () => {
  test('Darja home is RTL, English home is LTR', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-DZ');
    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('language switch keeps the same page', async ({ page }) => {
    await page.goto('/');
    await page.locator('header [data-lang-switch]').click();
    await expect(page).toHaveURL(/\/en\/$/);
    await page.locator('header [data-lang-switch]').click();
    await expect(page).toHaveURL(/localhost:\d+\/$/);
  });

  test('hreflang alternates and canonical are present', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/en\/$/);
    await expect(page.locator('link[hreflang="ar-DZ"]')).toHaveCount(1);
    await expect(page.locator('link[hreflang="en"]')).toHaveCount(1);
    await expect(page.locator('link[hreflang="x-default"]')).toHaveCount(1);
  });
});

test.describe('theme', () => {
  test('follows the system preference by default', async ({ browser }) => {
    for (const scheme of ['light', 'dark'] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await ctx.close();
    }
  });

  test('toggle switches, updates aria-pressed and survives reload', async ({ page }) => {
    const errors = watchErrors(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en/');
    const html = page.locator('html');
    const toggle = page.locator('header [data-theme-toggle]');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('header [data-theme-toggle]')).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });

  test('no flash: the stored theme is applied before <body> is parsed', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fm-theme', 'light');
      } catch {
        /* ignore */
      }
      const w = window as unknown as { __themeAtBody?: string | null };
      new MutationObserver((_, obs) => {
        if (document.body) {
          w.__themeAtBody = document.documentElement.getAttribute('data-theme');
          obs.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('/');
    const themeAtBody = await page.evaluate(
      () => (window as unknown as { __themeAtBody?: string | null }).__themeAtBody,
    );
    expect(themeAtBody).toBe('light');
  });

  test('works when localStorage throws (in-app browsers)', async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('header [data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(errors).toEqual([]);
  });
});

test('no CSP violations or script errors on any page', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  // (/404/ is left out: it answers with HTTP 404, which browsers log by design.)
  const paths = ['/', '/trips/', '/trips/djanet-tassili/', '/join/', '/privacy/'];
  for (const path of [...paths, ...paths.map((p) => `/en${p}`)]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  // Open the lightbox and submit the form too (they load their own scripts).
  await page.goto('/trips/jijel/');
  await page.locator('[data-gallery-item]').first().click();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('CSP header is served and only the theme script is inline', async ({ page, request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self' 'sha256-");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  await page.goto('/');
  const inline = await page.$$eval('script:not([src])', (els) =>
    (els as HTMLScriptElement[]).filter((s) => !s.type || s.type === 'module' || s.type === 'text/javascript').length,
  );
  expect(inline).toBe(1); // the theme bootstrap
});
