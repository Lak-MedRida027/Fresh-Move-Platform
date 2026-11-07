import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = ['/', '/trips/', '/trips/chelia-summit/', '/trips/e2e-open-trip/', '/trips/e2e-full-trip/', '/reservation/', '/join/', '/privacy/', '/404/'];
const LANGS = [
  ['ar', ''],
  ['en', '/en'],
] as const;
const THEMES = ['dark', 'light'] as const;

for (const theme of THEMES) {
  for (const [lang, prefix] of LANGS) {
    for (const path of PAGES) {
      const url = `${prefix}${path}`;
      test(`axe: ${url} (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.goto(url);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
          .analyze();
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        const report = blocking.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
        }));
        expect(report, `${lang} ${theme} ${url}`).toEqual([]);
      });
    }
  }
}

test('axe: form with errors visible and lightbox open have no serious issues', async ({ page }) => {
  await page.goto('/en/join/');
  await page.locator('[data-submit]').click();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

  await page.goto('/trips/djanet-tassili/');
  await page.locator('[data-gallery-item]').first().click();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});

test('touch targets are at least 44px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const url of ['/', '/en/trips/', '/en/trips/jijel/', '/join/']) {
    await page.goto(url);
    const small = await page.$$eval(
      'header a, header button, footer a, footer button, .btn, .chip, [data-gallery-item], .faq__item summary, .region__link',
      (els) =>
        els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && style.visibility !== 'hidden' && (r.height < 44 || r.width < 44);
          })
          .map((el) => `${el.tagName.toLowerCase()}.${el.className} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
    );
    expect(small, url).toEqual([]);
  }
});

test('skip link is first and moves focus to main', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not Tab to links by default');
  await page.goto('/en/');
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('visible focus ring in both themes', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not Tab to links by default');
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/en/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as Element);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  }
});

test('reduced motion: reveal content is visible without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/');
  const opacity = await page.locator('.reveal').last().evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe('1');
});

test('every image has alt text in the page language', async ({ page }) => {
  for (const url of ['/', '/en/', '/trips/chelia-summit/', '/en/trips/chelia-summit/', '/trips/', '/en/trips/']) {
    await page.goto(url);
    const missing = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.hasAttribute('alt')).map((i) => i.src));
    expect(missing, url).toEqual([]);
  }
  await page.goto('/trips/chelia-summit/');
  await expect(page.locator('.trip-hero__img img.trip-photo__img')).toHaveAttribute('alt', /قمة شيليا/);
  await page.goto('/en/trips/chelia-summit/');
  await expect(page.locator('.trip-hero__img img.trip-photo__img')).toHaveAttribute('alt', /Chelia summit/);
});
