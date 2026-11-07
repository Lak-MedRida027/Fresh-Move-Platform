import { expect, test, type Page } from '@playwright/test';

async function fillValid(page: Page) {
  await page.locator('[data-field="fullName"]').fill('Lina Benali');
  await page.locator('[data-field="phone"]').fill('0661 23 45 67');
  await page.locator('[data-field="wilaya"]').selectOption('05');
  await page.locator('[data-field="age"]').fill('24');
  await page.locator('[data-field="consent"]').check();
}

for (const [lang, prefix] of [
  ['ar', ''],
  ['en', '/en'],
] as const) {
  test.describe(`membership form (${lang})`, () => {
    test('empty submit shows inline errors and an announced summary', async ({ page }) => {
      await page.goto(`${prefix}/join/`);
      await page.locator('[data-submit]').click();
      const summary = page.locator('[data-error-summary]');
      await expect(summary).toBeVisible();
      await expect(summary).toHaveAttribute('aria-live', 'assertive');
      await expect(summary).toBeFocused();
      await expect(summary.locator('li')).toHaveCount(5);
      for (const field of ['fullName', 'phone', 'wilaya', 'age', 'consent']) {
        await expect(page.locator(`[data-error-for="${field}"]`)).toBeVisible();
        await expect(page.locator(`[data-field="${field}"]`)).toHaveAttribute('aria-invalid', 'true');
      }
      // Summary links move focus to the field
      await summary.locator('a').nth(1).click();
      await expect(page.locator('[data-field="phone"]')).toBeFocused();
    });

    test('invalid phone shows the phone error on blur', async ({ page }) => {
      await page.goto(`${prefix}/join/`);
      const phone = page.locator('[data-field="phone"]');
      await phone.fill('0851234567');
      await phone.blur();
      const error = page.locator('[data-error-for="phone"]');
      await expect(error).toBeVisible();
      await expect(error).toContainText(lang === 'en' ? "doesn't look right" : 'ماشي صحيح');
      await phone.fill('0551234567');
      await expect(error).toBeHidden();
    });

    test('under-age shows the minimum age error', async ({ page }) => {
      await page.goto(`${prefix}/join/`);
      await page.locator('[data-field="age"]').fill('15');
      await page.locator('[data-field="age"]').blur();
      await expect(page.locator('[data-error-for="age"]')).toContainText('18');
    });

    test('valid submit (API mocked) shows the success state with Instagram buttons', async ({ page }) => {
      let sent: Record<string, unknown> | null = null;
      await page.route('**/api/join', async (route) => {
        sent = route.request().postDataJSON();
        expect(route.request().headers()['content-type']).toContain('application/json');
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      });
      await page.goto(`${prefix}/join/`);
      await fillValid(page);
      const submit = page.locator('[data-submit]');
      await submit.click();
      await expect(submit).toBeDisabled(); // loading state while sending
      const success = page.locator('[data-success]');
      await expect(success).toBeVisible();
      await expect(page.locator('[data-success-title]')).toBeFocused();
      await expect(success.locator('a[href="https://ig.me/m/fresh_move1"]')).toHaveCount(1);
      await expect(success.locator('a[href="https://www.instagram.com/fresh_move1/"]')).toHaveCount(1);
      expect(sent).toMatchObject({
        fullName: 'Lina Benali',
        phone: '0661 23 45 67',
        wilaya: '05',
        age: '24',
        consent: true,
        lang,
        website: '',
      });
      expect(typeof sent!.startedAt).toBe('number');
      // Turnstile (Cloudflare's always-pass test key in dev/CI) produced a token.
      expect(String(sent!.turnstileToken ?? '').length).toBeGreaterThan(0);
    });

    test('server failure shows a clear message and the DM fallback', async ({ page }) => {
      await page.route('**/api/join', (route) =>
        route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"error":"upstream"}' }),
      );
      await page.goto(`${prefix}/join/`);
      await fillValid(page);
      await page.locator('[data-submit]').click();
      const failure = page.locator('[data-failure]');
      await expect(failure).toBeVisible();
      await expect(failure.locator('a[href="https://ig.me/m/fresh_move1"]')).toHaveCount(1);
      await expect(page.locator('[data-submit]')).toBeEnabled();
    });

    test('server-side field errors are shown inline', async ({ page }) => {
      await page.route('**/api/join', (route) =>
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'validation', fields: { phone: 'phone.invalid' } }),
        }),
      );
      await page.goto(`${prefix}/join/`);
      await fillValid(page);
      await page.locator('[data-submit]').click();
      await expect(page.locator('[data-error-for="phone"]')).toBeVisible();
    });
  });
}

test('home page has the form in the Join section and the hero CTA scrolls to it', async ({ page }) => {
  await page.goto('/en/');
  await page.locator('.hero a[href="#join"]').click();
  await expect(page).toHaveURL(/#join$/);
  await expect(page.locator('#join [data-join-form]')).toBeInViewport();
});

test('phone and age fields use numeric keyboards', async ({ page }) => {
  await page.goto('/join/');
  await expect(page.locator('[data-field="phone"]')).toHaveAttribute('inputmode', 'tel');
  await expect(page.locator('[data-field="phone"]')).toHaveAttribute('type', 'tel');
  await expect(page.locator('[data-field="age"]')).toHaveAttribute('inputmode', 'numeric');
  await expect(page.locator('select[data-field="wilaya"] option')).toHaveCount(70); // placeholder + 69
});

test('honeypot is hidden from people and keyboard', async ({ page }) => {
  await page.goto('/en/join/');
  const trap = page.locator('input[name="website"]');
  await expect(trap).toHaveAttribute('tabindex', '-1');
  const wrapper = page.locator('.form__trap');
  await expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  const box = await wrapper.boundingBox();
  expect(box === null || (box.width <= 1 && box.height <= 1)).toBe(true);
});
