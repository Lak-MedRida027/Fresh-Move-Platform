import { expect, test } from '@playwright/test';

const visibleCards = (page: import('@playwright/test').Page) => page.locator('[data-trip]:visible');

test.describe('trips list filters', () => {
  for (const prefix of ['', '/en']) {
    test(`filter by terrain and region (${prefix || 'ar'})`, async ({ page }) => {
      await page.goto(`${prefix}/trips/`);
      const total = await page.locator('[data-trip]').count();
      expect(total).toBeGreaterThanOrEqual(14);
      await expect(visibleCards(page)).toHaveCount(total);

      await page.locator('label.chip:has(input[name="terrain"][value="desert"])').click();
      await expect(visibleCards(page)).toHaveCount(1);
      await expect(page).toHaveURL(/terrain=desert/);
      await expect(page.locator('[data-trip-count]')).toContainText('1');

      await page.locator('label.chip:has(input[name="terrain"][value="mountain"])').click();
      await page.locator('label.chip:has(input[name="region"][value="babors"])').click();
      const babMountain = await visibleCards(page).count();
      expect(babMountain).toBeGreaterThan(0);
      for (const card of await visibleCards(page).all()) {
        await expect(card).toHaveAttribute('data-region', 'babors');
        await expect(card).toHaveAttribute('data-terrain-list', /mountain/);
      }

      await page.locator('[data-trip-reset]').click();
      await expect(visibleCards(page)).toHaveCount(total);
    });
  }

  test('filters are keyboard usable and read from the URL', async ({ page }) => {
    await page.goto('/en/trips/?region=sahara');
    await expect(visibleCards(page)).toHaveCount(1);
    const all = page.locator('input[name="terrain"][value=""]');
    await all.focus();
    await page.keyboard.press('ArrowRight'); // radio group: moves + checks next option
    await expect(page.locator('input[name="terrain"]:checked')).not.toHaveValue('');
  });

  test('empty state appears when nothing matches', async ({ page }) => {
    await page.goto('/en/trips/?terrain=desert&region=babors');
    await expect(visibleCards(page)).toHaveCount(0);
    await expect(page.locator('[data-trip-empty]')).toBeVisible();
  });
});

test.describe('trip detail gallery', () => {
  for (const prefix of ['', '/en']) {
    test(`lightbox opens, navigates with keys, closes with Esc (${prefix || 'ar'})`, async ({ page }) => {
      await page.goto(`${prefix}/trips/chelia-summit/`);
      await expect(page.locator('h1')).toHaveCount(1);
      const thumbs = page.locator('[data-gallery-item]');
      const count = await thumbs.count();
      expect(count).toBeGreaterThan(1);

      await thumbs.first().click();
      const dialog = page.locator('[data-lightbox]');
      await expect(dialog).toBeVisible();
      const counter = page.locator('[data-lightbox-counter]');
      await expect(counter).toContainText('1');
      await expect(page.locator('[data-lightbox-img]')).toHaveAttribute('alt', /\S/);
      // Focus is inside the dialog
      await expect(page.locator('[data-lightbox-close]')).toBeFocused();

      const rtl = prefix === '';
      await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight');
      await expect(counter).toContainText('2');
      await page.keyboard.press(rtl ? 'ArrowRight' : 'ArrowLeft');
      await expect(counter).toContainText('1');
      await page.keyboard.press('End');
      await expect(counter).toContainText(String(count));

      // Tab stays inside the dialog
      for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-lightbox]'))).toBe(true);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(thumbs.first()).toBeFocused();
    });
  }

  test('next / previous buttons work', async ({ page }) => {
    await page.goto('/en/trips/djanet-tassili/');
    await page.locator('[data-gallery-item]').nth(1).click();
    const counter = page.locator('[data-lightbox-counter]');
    await expect(counter).toContainText('2');
    await page.locator('[data-lightbox-next]').click();
    await expect(counter).toContainText('3');
    await page.locator('[data-lightbox-prev]').click();
    await page.locator('[data-lightbox-prev]').click();
    await expect(counter).toContainText('1');
    await page.locator('[data-lightbox-close]').click();
    await expect(page.locator('[data-lightbox]')).toBeHidden();
  });
});

test.describe('Instagram is the only booking path', () => {
  const IG = /^https:\/\/(www\.instagram\.com\/fresh_move1\/|ig\.me\/m\/fresh_move1)$/;
  const pages = ['/', '/en/', '/trips/', '/en/trips/', '/trips/chelia-summit/', '/en/trips/chelia-summit/', '/join/', '/en/join/'];

  for (const path of pages) {
    test(`trip CTAs point to Instagram on ${path}`, async ({ page }) => {
      await page.goto(path);
      const igLinks = page.locator('[data-instagram-link]');
      expect(await igLinks.count()).toBeGreaterThan(0);
      for (const link of await igLinks.all()) {
        const href = (await link.getAttribute('href')) ?? '';
        if (href.includes('/p/')) continue; // optional link to a trip's Instagram post
        expect(href).toMatch(IG);
      }
      // No booking / payment forms or external links other than Instagram
      const external = await page.$$eval('a[href^="http"]', (as) =>
        as.map((a) => (a as HTMLAnchorElement).href).filter((h) => !h.startsWith(location.origin)),
      );
      for (const href of external) expect(href).toMatch(/instagram\.com|ig\.me/);
      await expect(page.locator('form[action*="book"], form[action*="pay"], input[type="password"]')).toHaveCount(0);
    });
  }

  test('trip page CTA offers DM and follow', async ({ page }) => {
    await page.goto('/en/trips/el-kala/');
    const cta = page.locator('.trip-cta');
    await expect(cta.locator('a[href="https://ig.me/m/fresh_move1"]')).toHaveCount(1);
    await expect(cta.locator('a[href="https://www.instagram.com/fresh_move1/"]')).toHaveCount(1);
  });
});

test.describe('pages', () => {
  for (const path of ['/', '/en/', '/trips/', '/en/trips/', '/join/', '/en/join/', '/privacy/', '/en/privacy/']) {
    test(`${path} has exactly one h1 and a title`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('h1')).toHaveCount(1);
      expect((await page.title()).length).toBeGreaterThan(5);
    });
  }

  test('unknown URL shows the on-brand 404 in both languages', async ({ page }) => {
    const res = await page.goto('/this-does-not-exist/');
    expect(res?.status()).toBe(404);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.notfound__other')).toBeVisible();
    // On Cloudflare, unknown English URLs get the English 404 (Darja block below it).
    const en = await page.goto('/en/nope/');
    expect(en?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toHaveText('Lost on the trail?');
    // Unknown trip slugs are 404s too (not 500s).
    expect((await page.goto('/en/trips/does-not-exist/'))?.status()).toBe(404);
    expect((await page.goto('/trips/does-not-exist/'))?.status()).toBe(404);
  });

  test('language switch stays on the same trip', async ({ page }) => {
    await page.goto('/trips/jijel/');
    await page.locator('header [data-lang-switch]').click();
    await expect(page).toHaveURL(/\/en\/trips\/jijel\/$/);
  });
});
