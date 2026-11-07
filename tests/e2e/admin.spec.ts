import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { totp } from '../totp';
import { E2E, localDb, readAdmins } from './fixtures';

type Who = 'owner' | 'organizer';

/**
 * Sign in once per browser project and role, then reuse the session cookies:
 * the login endpoint is rate-limited per IP (all tests share 127.0.0.1).
 */
async function signIn(page: Page, info: TestInfo, who: Who, prefix = '') {
  const file = `.playwright/session-${info.project.name}-${who}.json`;
  if (existsSync(file)) {
    await page.context().addCookies(JSON.parse(readFileSync(file, 'utf8')));
    await page.goto(`${prefix}/admin/`);
    if (new URL(page.url()).pathname.endsWith('/admin/')) return;
    await page.context().clearCookies();
  }
  await login(page, info, who, prefix);
  writeFileSync(file, JSON.stringify(await page.context().cookies()));
}

async function login(page: Page, info: TestInfo, who: Who, prefix = '') {
  const a = readAdmins(info.project.name)[who];
  await page.goto(`${prefix}/admin/login/`);
  await page.locator('#login-email').fill(a.email);
  await page.locator('#login-password').fill(a.password);
  await page.locator('[data-login-form] button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`${prefix}/admin/mfa/$`));
  await page.locator('#mfa-code').fill(totp(a.totpSecret!));
  await page.locator('form[action="/admin/api/mfa/"] button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`${prefix}/admin/$`));
}

const ADMIN_PAGES = ['/admin/', '/admin/trips/', '/admin/trips/new/', '/admin/reservations/', '/admin/members/', '/admin/admins/', '/admin/audit/', '/admin/settings/'];

test.describe('admin access control', () => {
  test('every admin page redirects to login when signed out', async ({ request }) => {
    const { data: trip } = await localDb().from('trips').select('id').eq('slug', E2E.open).single();
    const pages = [
      ...ADMIN_PAGES,
      `/admin/trips/${trip!.id}/`,
      `/admin/trips/${trip!.id}/photos/`,
      `/admin/trips/${trip!.id}/reservations/`,
      '/admin/members/00000000-0000-0000-0000-000000000000/',
      '/admin/mfa/',
    ];
    for (const p of [...pages, ...pages.map((x) => `/en${x}`)]) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status(), p).toBe(303);
      expect(res.headers().location, p).toMatch(/\/admin\/login\/$/);
      expect(res.headers()['x-robots-tag'] ?? 'noindex', p).toContain('noindex');
    }
  });

  test('every admin API returns 401 when signed out', async ({ request }) => {
    for (const api of ['reservations', 'trips', 'members', 'admins', 'settings']) {
      const res = await request.post(`/admin/api/${api}/`, { form: { action: 'delete', id: 'x' }, maxRedirects: 0 });
      expect(res.status(), api).toBe(401);
    }
  });

  test('wrong password shows one generic error', async ({ page }, info) => {
    await page.goto('/en/admin/login/');
    await page.locator('#login-email').fill(readAdmins(info.project.name).owner.email);
    await page.locator('#login-password').fill('not-the-password');
    await page.locator('[data-login-form] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/en\/admin\/login\/\?error=login$/);
    await expect(page.locator('[data-flash="error"]')).toHaveText('Wrong email or password.');
  });

  test('password alone is not enough: MFA page until the code is entered', async ({ page }, info) => {
    const a = readAdmins(info.project.name).organizer;
    await page.goto('/en/admin/login/');
    await page.locator('#login-email').fill(a.email);
    await page.locator('#login-password').fill(a.password);
    await page.locator('[data-login-form] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/en\/admin\/mfa\/$/);
    await page.goto('/en/admin/reservations/');
    await expect(page).toHaveURL(/\/en\/admin\/mfa\/$/);
    await page.locator('#mfa-code').fill('000000');
    await page.locator('form[action="/admin/api/mfa/"] button[type="submit"]').click();
    await expect(page.locator('[data-flash="error"]')).toBeVisible();
  });

  test('robots.txt disallows /admin', async ({ request }) => {
    const txt = await (await request.get('/robots.txt')).text();
    expect(txt).toContain('Disallow: /admin/');
  });
});

test.describe('admin flows', () => {
  test.describe.configure({ mode: 'serial' });

  test('first sign-in walks a new admin through MFA enrolment', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'one enrolment per run (the account is fresh each run)');
    const a = readAdmins(info.project.name).fresh;
    await page.goto('/en/admin/login/');
    await page.locator('#login-email').fill(a.email);
    await page.locator('#login-password').fill(a.password);
    await page.locator('[data-login-form] button[type="submit"]').click();
    await expect(page.locator('h1')).toHaveText('Set up two-step verification');
    await expect(page.locator('img.qr')).toBeVisible();
    const secret = (await page.locator('[data-totp-secret]').textContent())!.trim();
    await page.locator('#mfa-code').fill(totp(secret));
    await page.locator('form[action="/admin/api/mfa/"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/en\/admin\/$/);
    await expect(page.locator('h1')).toHaveText('Overview');
  });

  test('owner: create a trip, publish it, a visitor books, confirm, add a DM booking, complete it', async ({ page }, info) => {
    await signIn(page, info, 'owner', '/en');
    await page.goto('/en/admin/');
    await expect(page.locator('[data-stat="pending"]')).toBeVisible();

    // Create (draft) with Darja + English fields.
    const title = `Admin E2E ${info.project.name} ${Date.now()}`;
    await page.goto('/en/admin/trips/new/');
    await page.locator('input[name="title_ar"]').fill('خرجة تجريبية من الإدارة');
    await page.locator('input[name="title_en"]').fill(title);
    await page.locator('textarea[name="summary_ar"]').fill('ملخص قصير.');
    await page.locator('textarea[name="summary_en"]').fill('Short summary.');
    await page.locator('textarea[name="payment_instructions_ar"]').fill('BaridiMob: 00799999000000000001');
    await page.locator('textarea[name="payment_instructions_en"]').fill('BaridiMob: 00799999000000000001');
    await page.locator('#tf-region').selectOption('babors');
    await page.locator('input[name="terrain"][value="mountain"]').check();
    await page.locator('#tf-difficulty').selectOption('medium');
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await page.locator('#tf-start').fill(day(30));
    await page.locator('#tf-end').fill(day(31));
    await page.locator('#tf-price').fill('2000');
    await page.locator('#tf-capacity').fill('2');
    await page.locator('[data-save-trip]').click();
    await expect(page.locator('[data-flash="ok"]')).toHaveText('Created ✓');
    const tripUrl = page.url().split('?')[0]!;
    const slug = await page.locator('#tf-slug').inputValue();
    expect(slug).toMatch(/^admin-e2e-/);

    // Not public while draft.
    expect((await page.request.get(`/en/trips/${slug}/`)).status()).toBe(404);

    // Publish.
    await page.locator('#tf-status').selectOption('open');
    await page.locator('[data-save-trip]').click();
    await expect(page.locator('[data-flash="ok"]')).toHaveText('Saved ✓');

    // A visitor books on the public site.
    const visitor = await page.context().browser()!.newPage();
    await visitor.goto(`/en/trips/${slug}/`);
    await expect(visitor.locator('h1')).toContainText(title);
    const phone = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    await visitor.locator('[data-reserve-form] [data-field="fullName"]').fill('Zz Visitor');
    await visitor.locator('[data-reserve-form] [data-field="phone"]').fill(phone);
    await visitor.locator('[data-reserve-form] [data-field="wilaya"]').selectOption('19');
    await visitor.locator('[data-reserve-form] [data-field="age"]').fill('30');
    await visitor.locator('[data-reserve-form] [data-field="consent"]').check();
    await visitor.waitForTimeout(3200);
    await visitor.locator('[data-reserve-form] [data-submit]').click();
    await expect(visitor.locator('[data-code]')).toHaveText(/^FM-[2-9A-HJ-NP-Z]{5}$/, { timeout: 20_000 });
    const code = (await visitor.locator('[data-code]').textContent())!.trim();
    await visitor.close();

    // Admin confirms the payment.
    await page.goto(`${tripUrl}reservations/`);
    const row = page.locator(`tr[data-reservation="${code}"]`);
    await expect(row).toHaveAttribute('data-status', 'pending');
    await row.locator('summary').click();
    await row.locator('form:has(input[name="action"][value="confirm"]) select[name="method"]').selectOption('baridimob');
    await row.locator('form:has(input[name="action"][value="confirm"]) input[name="amount"]').fill('2000');
    await row.locator('form:has(input[name="action"][value="confirm"]) button[type="submit"]').click();
    await expect(page.locator('[data-flash="ok"]')).toHaveText('Reservation confirmed ✓');
    await expect(page.locator(`tr[data-reservation="${code}"]`)).toHaveAttribute('data-status', 'confirmed');

    // Someone who booked by Instagram DM, confirmed right away.
    const add = page.locator('[data-add-reservation]');
    await add.locator('#ar-name').fill('Zz Dm Booker');
    await add.locator('#ar-phone').fill(`06${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`);
    await add.locator('#ar-wilaya').selectOption('16');
    await add.locator('#ar-age').fill('27');
    await add.locator('input[name="confirm"]').check();
    await add.locator('button[type="submit"]').click();
    await expect(page.locator('[data-flash="ok"]')).toHaveText('Reservation added ✓');
    await expect(page.locator('tr[data-status="confirmed"]')).toHaveCount(2);

    // Mark completed → it moves to Past trips.
    await page.goto(tripUrl);
    await page.locator('#tf-status').selectOption('completed');
    await page.locator('[data-save-trip]').click();
    await expect(page.locator('[data-flash="ok"]')).toBeVisible();
    await page.goto('/en/trips/');
    await expect(page.locator('#past [data-trip]', { hasText: title })).toBeVisible();
    await expect(page.locator('#upcoming [data-trip]', { hasText: title })).toHaveCount(0);

    // Every change is in the audit log.
    await page.goto('/en/admin/audit/?entity=trips');
    await expect(page.locator('[data-audit] tbody tr').first()).toBeVisible();
  });

  test('organizer cannot open owner-only pages or delete members', async ({ page }, info) => {
    await signIn(page, info, 'organizer', '/en');
    await page.goto('/en/admin/');
    await expect(page.locator('nav[aria-label="Admin navigation"] a', { hasText: 'Admins' })).toHaveCount(0);
    for (const p of ['/en/admin/admins/', '/en/admin/audit/', '/en/admin/settings/']) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/en\/admin\/\?error=owner_only$/);
    }
    const res = await page.request.post('/admin/api/members/', {
      form: { action: 'delete', id: '00000000-0000-0000-0000-000000000000', lang: 'en' },
      headers: { Origin: new URL(page.url()).origin },
      maxRedirects: 0,
    });
    expect(res.headers().location).toContain('error=owner_only');
  });

  test('language switch keeps the admin page', async ({ page }, info) => {
    await signIn(page, info, 'organizer');
    await page.goto('/admin/reservations/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('.admin-bar a[hreflang="en"]').click();
    await expect(page).toHaveURL(/\/en\/admin\/reservations\/$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('axe: no serious issues on admin pages (both languages and themes)', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-safari', 'covered by the other two projects');
    test.setTimeout(240_000); // ~44 pages × axe
    await signIn(page, info, 'owner');
    const { data: trip } = await localDb().from('trips').select('id').eq('slug', E2E.open).single();
    const { data: member } = await localDb().from('members').select('id').limit(1).single();
    const pages = [
      ...ADMIN_PAGES,
      `/admin/trips/${trip!.id}/`,
      `/admin/trips/${trip!.id}/reservations/`,
      `/admin/members/${member!.id}/`,
    ];
    for (const theme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      for (const p of [...pages, ...pages.map((x) => `/en${x}`)]) {
        await page.goto(p);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
        const bad = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
        expect(bad, `${theme} ${p}`).toEqual([]);
      }
    }
    // Login page (signed out).
    await page.context().clearCookies();
    await page.goto('/en/admin/login/');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
