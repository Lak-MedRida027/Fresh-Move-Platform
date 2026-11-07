import { expect, test, type Page } from '@playwright/test';
import { E2E } from './fixtures';

const CODE = /^FM-[2-9A-HJ-NP-Z]{5}$/;
const randomPhone = () => `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const randomCode = () => `FM-${Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join('')}`;

async function fillPerson(page: Page, phone: string, name = 'Zz Testeur') {
  await page.locator('[data-reserve-form] [data-field="fullName"]').fill(name);
  await page.locator('[data-reserve-form] [data-field="phone"]').fill(phone);
  await page.locator('[data-reserve-form] [data-field="wilaya"]').selectOption('05');
  await page.locator('[data-reserve-form] [data-field="age"]').fill('26');
  await page.locator('[data-reserve-form] [data-field="consent"]').check();
  // The server rejects forms sent faster than a person could (3 s).
  await page.waitForTimeout(3200);
}

for (const [lang, prefix] of [
  ['ar', ''],
  ['en', '/en'],
] as const) {
  test.describe(`reservations (${lang})`, () => {
    test('upcoming trip shows on home and trips page with a seats badge', async ({ page }) => {
      await page.goto(`${prefix}/`);
      const card = page.locator('#upcoming .trip-card', { hasText: lang === 'en' ? 'E2E Open Trip' : 'خرجة مفتوحة' });
      await expect(card).toBeVisible();
      await expect(card.locator('[data-seats-state]')).toBeVisible();
      await page.goto(`${prefix}/trips/`);
      await expect(page.locator('#upcoming [data-trip]').first()).toBeVisible();
      await expect(page.locator('#past [data-trip]').first()).toBeVisible();
    });

    test('reserve → success screen with code → check my reservation shows pending', async ({ page }) => {
      const phone = randomPhone();
      await page.goto(`${prefix}/trips/${E2E.open}/`);
      await expect(page.locator('[data-seats-state]').first()).toBeVisible();
      await expect(page.locator('[data-countdown]')).not.toBeEmpty();
      await fillPerson(page, phone);
      await page.locator('[data-reserve-form] [data-submit]').click();

      const done = page.locator('[data-reserve-root] [data-success]');
      await expect(done).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-success-title]')).toBeFocused();
      const code = (await page.locator('[data-code]').textContent())!.trim();
      expect(code).toMatch(CODE);
      await expect(page.locator('[data-status]')).toHaveText(lang === 'en' ? 'Held: payment needed' : 'محجوزة: لازم تخلّص');
      await expect(page.locator('[data-hold]')).toContainText(lang === 'en' ? 'Algeria time' : 'توقيت الجزائر');
      await expect(done.locator('[data-proof]')).toHaveAttribute('href', 'https://ig.me/m/fresh_move1');
      await expect(done).toContainText('BaridiMob');

      // Check status with phone + code (lowercase and without the dash is fine).
      await page.goto(`${prefix}/reservation/`);
      await page.locator('[data-field="phone"]').fill(phone);
      await page.locator('[data-field="code"]').fill(code.toLowerCase().replace('-', ' '));
      await page.waitForTimeout(3200);
      await page.locator('[data-status-form] [data-submit]').click();
      const result = page.locator('[data-result]');
      await expect(result).toBeVisible({ timeout: 20_000 });
      await expect(result.locator('[data-r-code]')).toHaveText(code);
      await expect(result.locator('[data-r-status]')).toHaveText(lang === 'en' ? 'Held: payment needed' : 'محجوزة: لازم تخلّص');
      await expect(result.locator('[data-r-trip]')).toHaveAttribute('href', `${prefix}/trips/${E2E.open}/`);
    });

    test('reserving twice with the same phone says "already booked" without revealing the code', async ({ page }) => {
      const phone = randomPhone();
      await page.goto(`${prefix}/trips/${E2E.open}/`);
      await fillPerson(page, phone);
      await page.locator('[data-reserve-form] [data-submit]').click();
      await expect(page.locator('[data-code]')).toHaveText(CODE, { timeout: 20_000 });
      const first = await page.locator('[data-code]').textContent();

      await page.goto(`${prefix}/trips/${E2E.open}/`);
      await fillPerson(page, phone, 'Zz Someone Else');
      await page.locator('[data-reserve-form] [data-submit]').click();
      await expect(page.locator('[data-existing]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-code-box]')).toBeHidden();
      await expect(page.locator('body')).not.toContainText(first!);
    });

    test('full trip offers the waitlist and explains it', async ({ page }) => {
      await page.goto(`${prefix}/trips/${E2E.full}/`);
      await expect(page.locator('[data-seats-state="full"]')).toBeVisible();
      await expect(page.locator('[data-reserve-form] [data-submit]')).toHaveText(
        lang === 'en' ? 'Join the waitlist' : 'سجّلني في قائمة الانتظار',
      );
      await fillPerson(page, randomPhone());
      await page.locator('[data-reserve-form] [data-submit]').click();
      await expect(page.locator('[data-success-title]')).toHaveText(
        lang === 'en' ? "You're on the waitlist" : 'راك في قائمة الانتظار',
        { timeout: 20_000 },
      );
      await expect(page.locator('[data-next-waitlist]')).toBeVisible();
      await expect(page.locator('[data-hold]')).toBeHidden();
    });

    test('closed trip shows no form, only the Instagram links', async ({ page }) => {
      await page.goto(`${prefix}/trips/${E2E.closed}/`);
      await expect(page.locator('[data-reserve-form]')).toHaveCount(0);
      const closed = page.locator('[data-registrations-closed]');
      await expect(closed).toBeVisible();
      await expect(closed.locator('a[href="https://ig.me/m/fresh_move1"]')).toHaveCount(1);
    });

    test('check my reservation: wrong code → generic not found', async ({ page }) => {
      await page.goto(`${prefix}/reservation/`);
      await page.locator('[data-field="phone"]').fill(randomPhone());
      await page.locator('[data-field="code"]').fill(randomCode());
      await page.waitForTimeout(3200);
      await page.locator('[data-status-form] [data-submit]').click();
      await expect(page.locator('[data-status-form] [data-failure]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-failure-text]')).toHaveText(
        lang === 'en'
          ? "We couldn't find a booking with this phone and code. Check them and try again."
          : 'ما لقيناش حجز بهاد الرقم وهاد الكود. تأكد منهم وعاود.',
      );
      await expect(page.locator('[data-result]')).toBeHidden();
    });
  });
}

test('reservation form validates before sending (empty submit)', async ({ page }) => {
  await page.goto(`/en/trips/${E2E.open}/`);
  await page.locator('[data-reserve-form] [data-submit]').click();
  await expect(page.locator('[data-reserve-form] [data-error-summary]')).toBeFocused();
  await expect(page.locator('[data-reserve-form] [data-error-summary] li')).toHaveCount(5);
});
