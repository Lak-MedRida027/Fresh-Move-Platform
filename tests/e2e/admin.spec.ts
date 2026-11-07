import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { totp } from '../totp';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { E2E, localDb, PHOTOS, readAdmins } from './fixtures';

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

/** Clicks the page's Excel export and reads the downloaded file back. */
async function exportExcel(page: Page) {
  const box = page.locator('[data-export]');
  await expect(box.locator('[data-export-button]')).toBeEnabled();
  // The spreadsheet library must run under the strict CSP (no eval): no errors, no violations.
  const errors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => void (m.type() === 'error' && errors.push(m.text()));
  const onError = (e: Error) => void errors.push(e.message);
  page.on('console', onConsole);
  page.on('pageerror', onError);
  await page.evaluate(() =>
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective}`)),
  );
  const [download] = await Promise.all([page.waitForEvent('download'), box.locator('[data-export-button]').click()]);
  await expect(box.locator('[data-export-status]')).toHaveAttribute('data-state', 'done');
  page.off('console', onConsole);
  page.off('pageerror', onError);
  expect(errors).toEqual([]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(await download.path()) as unknown as ArrayBuffer);
  return { wb, filename: download.suggestedFilename(), status: (await box.locator('[data-export-status]').textContent()) ?? '' };
}

const cells = (ws: ExcelJS.Worksheet, row: number) => (ws.getRow(row).values as unknown[]).slice(1);

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
    for (const api of ['reservations', 'trips', 'members', 'admins', 'settings', 'photos', 'export']) {
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
    // The whole admin story in one test (~25 s alone, including the 3 s minimum form time and an Excel
    // export); the default 30 s is too tight when three browsers run the suite at once.
    test.setTimeout(90_000);
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

    // Export the trip's list to Excel and check the file.
    const tripId = tripUrl.split('/').filter(Boolean).pop()!;
    const { wb, filename, status } = await exportExcel(page);
    expect(filename).toBe(`fresh-move-reservations-${slug}-${new Date(Date.now() + 3_600_000).toISOString().slice(0, 10)}.xlsx`);
    expect(status).toBe('Downloaded: 2 rows.');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Reservations']);
    const sheet = wb.getWorksheet('Reservations')!;
    expect(sheet.rowCount).toBe(3);
    const head = cells(sheet, 1) as string[];
    const exported = [cells(sheet, 2), cells(sheet, 3)];
    expect(exported.map((r) => r[head.indexOf('Code')])).toContain(code);
    expect(exported.map((r) => r[head.indexOf('Status')])).toEqual(['Confirmed', 'Confirmed']);
    expect(exported.map((r) => String(r[head.indexOf('Name')])).sort()).toEqual(['Zz Dm Booker', 'Zz Visitor']);
    const phoneCell = sheet.getRow(2).getCell(head.indexOf('Phone') + 1);
    expect(phoneCell.type).toBe(ExcelJS.ValueType.String);
    expect(String(phoneCell.value)).toMatch(/^\+213[67]\d{8}$/);
    expect(cells(wb.getWorksheet('Summary')!, 2)).toEqual(['Trip', title]);
    // The export is in the audit log.
    const { data: logged } = await localDb().from('audit_log').select('entity, after').eq('action', 'export').eq('entity_id', tripId);
    expect(logged).toEqual([{ entity: 'reservations', after: { rows: 2, filter: {} } }]);

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

  test('photos: browser resize strips EXIF/GPS, alt text gates publishing, cover, order, delete', async ({ page }, info) => {
    test.setTimeout(120_000);
    const db = localDb();
    const { data: trip, error } = await db
      .from('trips')
      .insert({
        slug: `admin-e2e-photos-${info.project.name}-${Date.now()}`,
        title_ar: 'خرجة الصور',
        title_en: `Admin E2E Photos ${info.project.name}`,
        region: 'aures',
        terrain: ['mountain'],
        start_date: '2026-10-01',
        end_date: '2026-10-02',
        status: 'draft',
      })
      .select('id, slug')
      .single();
    if (error) throw error;
    await signIn(page, info, 'owner', '/en');
    const photosUrl = `/en/admin/trips/${trip.id}/photos/`;
    await page.goto(photosUrl);
    await expect(page.locator('.photo-card')).toHaveCount(0);

    // Upload three files: two good ones and one that is too small.
    await page.locator('input[name="upload-kind"][value="gallery"]').check();
    await page.locator('[data-files]').setInputFiles([PHOTOS.gps, PHOTOS.wide, PHOTOS.tiny]);
    const items = page.locator('.upload-item');
    await expect(items.nth(2)).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
    await expect(items.nth(0)).toHaveAttribute('data-state', 'done');
    await expect(items.nth(1)).toHaveAttribute('data-state', 'done');
    await expect(items.nth(2)).toContainText('too small');

    // What is in the database and in storage.
    const { data: rows } = await db.from('trip_images').select('*').eq('trip_id', trip.id).order('sort_order');
    expect(rows).toHaveLength(2);
    const [gps, wide] = rows!;
    const expected = {
      // EXIF orientation applied: the 1200×800 photo is upright (portrait).
      [gps!.id]: { lg: [800, 1200], md: [640, 960], sm: [320, 480] },
      [wide!.id]: { lg: [1600, 1067], md: [960, 640], sm: [480, 320] },
    };
    for (const row of rows!) {
      expect(row.kind).toBe('gallery');
      expect(row.placeholder).toMatch(/^data:image\/webp;base64,/);
      expect([row.width, row.height]).toEqual(expected[row.id]!.lg);
      let total = 0;
      for (const size of ['sm', 'md', 'lg'] as const) {
        const { data: blob, error: dlError } = await db.storage.from('trip-images').download(row[`path_${size}`]);
        if (dlError) throw dlError;
        const buf = Buffer.from(await blob.arrayBuffer());
        total += buf.length;
        expect(buf.subarray(0, 4).toString('latin1'), size).toBe('RIFF');
        expect(buf.subarray(8, 12).toString('latin1'), size).toBe('WEBP');
        const meta = await sharp(buf).metadata();
        expect([meta.width, meta.height], `${row.id} ${size}`).toEqual(expected[row.id]![size]);
        // No metadata survived: no EXIF/XMP chunk, no camera or GPS data.
        expect(meta.exif, size).toBeUndefined();
        expect(meta.xmp, size).toBeUndefined();
        expect(buf.includes(Buffer.from('EXIF')) || buf.includes(Buffer.from('TestCam')), size).toBe(false);
      }
      expect(row.size_bytes).toBe(total);
    }

    // Publishing is blocked until every photo has alt text in both languages.
    await page.goto(photosUrl);
    await expect(page.locator('.photo-card')).toHaveCount(2);
    await expect(page.locator('[data-missing-alt]')).toBeVisible();
    await page.goto(`/en/admin/trips/${trip.id}/`);
    await page.locator('#tf-status').selectOption('completed');
    await page.locator('[data-save-trip]').click();
    await expect(page.locator('[data-flash="error"]')).toContainText('description in Darja and English');

    await page.goto(photosUrl);
    for (const [i, row] of rows!.entries()) {
      const card = page.locator(`[data-photo="${row.id}"]`);
      await card.locator('textarea[name="alt_ar"]').fill(`صورة ${i + 1} من الخرجة`);
      await card.locator('textarea[name="alt_en"]').fill(`Trip photo ${i + 1}`);
      await card.locator('[data-photo-form] button[type="submit"]').click();
      await expect(page.locator('[data-flash="ok"]')).toHaveText('Saved ✓');
    }
    await expect(page.locator('[data-missing-alt]')).toHaveCount(0);

    // Cover and order.
    await page.locator(`[data-photo="${wide!.id}"]`).getByRole('button', { name: 'Use as cover' }).click();
    await expect(page.locator(`[data-photo="${wide!.id}"] [data-cover]`)).toBeVisible();
    await page.locator(`[data-photo="${wide!.id}"] [data-move="up"]`).click();
    await expect(page.locator('[data-flash="ok"]')).toHaveText('Order saved ✓');
    await expect(page.locator('.photo-card').first()).toHaveAttribute('data-photo', wide!.id);
    const { data: t2 } = await db.from('trips').select('cover_image_id').eq('id', trip.id).single();
    expect(t2!.cover_image_id).toBe(wide!.id);

    // Now it publishes, and the public page shows the photos with their alt text.
    await page.goto(`/en/admin/trips/${trip.id}/`);
    await page.locator('#tf-status').selectOption('completed');
    await page.locator('[data-save-trip]').click();
    await expect(page.locator('[data-flash="ok"]')).toBeVisible();
    await page.goto(`/trips/${trip.slug}/`);
    await expect(page.locator('img[alt="صورة 1 من الخرجة"]').first()).toBeAttached();

    // Delete a photo: row and all three files go.
    await page.goto(photosUrl);
    const card = page.locator(`[data-photo="${gps!.id}"]`);
    await card.locator('.action-menu summary').click();
    await card.locator('[data-delete-photo]').click();
    await expect(page.locator('[data-flash="ok"]')).toHaveText('Deleted ✓');
    await expect(page.locator('.photo-card')).toHaveCount(1);
    const listing = async () => (await db.storage.from('trip-images').list(`trips/${trip.id}`)).data?.map((o) => o.name) ?? [];
    expect((await listing()).filter((n) => n.startsWith(gps!.id))).toEqual([]);
    expect(await listing()).toHaveLength(3);

    // Delete the trip (owner): its remaining files go too.
    await page.goto(`/en/admin/trips/${trip.id}/`);
    await page.locator('form:has(input[name="action"][value="delete"]) button[type="submit"]').click();
    await expect(page.locator('[data-flash="ok"]')).toHaveText('Deleted ✓');
    expect(await listing()).toEqual([]);
  });

  test('photos: browsers without a WebP canvas encoder use the WebAssembly one', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'one browser is enough: the fallback is forced');
    const db = localDb();
    const { data: trip, error } = await db
      .from('trips')
      .insert({ slug: `admin-e2e-wasm-${Date.now()}`, title_ar: 'خرجة', title_en: 'Admin E2E WASM', region: 'aures', terrain: ['mountain'], status: 'draft' })
      .select('id')
      .single();
    if (error) throw error;
    // Make canvas.toBlob ignore WebP, like browsers that can't encode it.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, q?: number) {
        return original.call(this, cb, type === 'image/webp' ? 'image/png' : type, q);
      };
    });
    const wasm: string[] = [];
    page.on('request', (r) => r.url().endsWith('.wasm') && wasm.push(r.url()));
    await signIn(page, info, 'owner', '/en');
    await page.goto(`/en/admin/trips/${trip.id}/photos/`);
    await page.locator('[data-files]').setInputFiles([PHOTOS.wide]);
    await expect(page).toHaveURL(/ok=uploaded/, { timeout: 60_000 });
    expect(wasm.length).toBeGreaterThan(0);
    const { data: row } = await db.from('trip_images').select('path_lg').eq('trip_id', trip.id).single();
    const { data: blob } = await db.storage.from('trip-images').download(row!.path_lg);
    const buf = Buffer.from(await blob!.arrayBuffer());
    expect(buf.subarray(8, 12).toString('latin1')).toBe('WEBP');
    expect((await sharp(buf).metadata()).width).toBe(1600);
  });

  test('photos API: same-origin only, and storage is checked before a photo is added', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'API checks, one browser is enough');
    const { data: trip } = await localDb().from('trips').select('id').eq('slug', E2E.open).single();
    await signIn(page, info, 'owner');
    const post = (data: object, origin?: string) =>
      page.request.post('/admin/api/photos/', { data, headers: origin ? { Origin: origin } : {}, maxRedirects: 0 });
    const origin = new URL(page.url()).origin;
    expect((await post({ action: 'prepare', trip_id: trip!.id, kind: 'gallery' })).status()).toBe(403);
    expect((await post({ action: 'prepare', trip_id: trip!.id, kind: 'gallery' }, 'https://evil.example')).status()).toBe(403);
    const prep = await post({ action: 'prepare', trip_id: trip!.id, kind: 'gallery' }, origin);
    expect(prep.status()).toBe(200);
    const { id, uploads } = (await prep.json()) as { id: string; uploads: Record<string, string> };
    expect(Object.keys(uploads).sort()).toEqual(['lg', 'md', 'sm']);
    // Register without uploading anything: refused, nothing added.
    const reg = await post(
      { action: 'register', trip_id: trip!.id, id, kind: 'gallery', width: 1600, height: 1067, placeholder: 'data:image/webp;base64,AAAA' },
      origin,
    );
    expect(await reg.json()).toEqual({ ok: false, error: 'upload_incomplete' });
    const { data: row } = await localDb().from('trip_images').select('id').eq('id', id).maybeSingle();
    expect(row).toBeNull();
  });

  test('export: filtered members list in Darja, formulas neutralised, phones as text', async ({ page }, info) => {
    const db = localDb();
    // Names are at most 60 characters: keep the tag short (e.g. "Zz Exp mc1a2b3c4d").
    const run = `${info.project.name.split('-').map((w) => w[0]).join('')}${Date.now().toString(36)}`;
    const tag = `Zz Exp ${run}`;
    const phoneOf = () => `+2135${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const people = [
      { full_name: `=HYPERLINK("http://x.example","${tag}")`, phone: phoneOf(), wilaya_code: '05', age: 33, source: 'admin', notes: '@SUM(1)' },
      { full_name: `أمينة ${tag}`, phone: phoneOf(), wilaya_code: '16', age: 22, source: 'join_form', notes: null },
    ];
    const { data: inserted, error } = await db.from('members').insert(people).select('id');
    expect(error).toBeNull();
    try {
      await signIn(page, info, 'organizer');
      await page.goto(`/admin/members/?q=${encodeURIComponent(tag)}`);
      await expect(page.locator('[data-member-count]')).toHaveText('2 عضو');
      const { wb, filename, status } = await exportExcel(page);
      expect(filename).toMatch(/^fresh-move-members-\d{4}-\d{2}-\d{2}\.xlsx$/);
      expect(status).toBe('تنزّل: 2 سطر.');
      expect(wb.worksheets.map((w) => w.name)).toEqual(['الأعضاء']);
      const ws = wb.worksheets[0]!;
      expect(ws.views[0]).toMatchObject({ rightToLeft: true, state: 'frozen', ySplit: 1 });
      expect(ws.rowCount).toBe(3);
      const head = cells(ws, 1) as string[];
      const byName = new Map([2, 3].map((r) => [String(ws.getRow(r).getCell(1).value), ws.getRow(r)]));
      const evil = byName.get(`'${people[0]!.full_name}`);
      expect(evil, 'formula name starts with an apostrophe').toBeTruthy();
      expect(evil!.getCell(1).type).toBe(ExcelJS.ValueType.String);
      expect(evil!.getCell(head.indexOf('ملاحظات') + 1).value).toBe("'@SUM(1)");
      const amina = byName.get(people[1]!.full_name);
      expect(amina, 'Arabic name intact').toBeTruthy();
      expect(amina!.getCell(head.indexOf('التيليفون') + 1).value).toBe(people[1]!.phone);
      expect(amina!.getCell(head.indexOf('التيليفون') + 1).type).toBe(ExcelJS.ValueType.String);
      for (const sheet of wb.worksheets) sheet.eachRow((r) => r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)));

      // Recorded with the filter that was used.
      const { data: logged } = await db.from('audit_log').select('after').eq('action', 'export').eq('entity', 'members').contains('after', { filter: { q: tag } });
      expect(logged).toEqual([{ after: { rows: 2, filter: { q: tag } } }]);
    } finally {
      await db.from('members').delete().in('id', (inserted ?? []).map((m) => m.id));
    }
  });

  test('export API: same-origin JSON only, validated, signed-in admins only', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'API checks, one browser is enough');
    await signIn(page, info, 'organizer');
    const origin = new URL(page.url()).origin;
    const post = (data: unknown, headers: Record<string, string> = { Origin: origin }) =>
      page.request.post('/admin/api/export/', { data, headers, maxRedirects: 0 });
    const good = { kind: 'reservations', lang: 'en', query: 'status=confirmed' };
    const okRes = await post(good);
    expect(okRes.status()).toBe(200);
    expect(okRes.headers()['cache-control']).toContain('no-store');
    expect((await okRes.json()).spec.sheets[0].name).toBe('Reservations');
    expect((await post(good, { Origin: 'https://evil.example' })).status()).toBe(403);
    expect((await post(good, {})).status()).toBe(403);
    expect((await post({ ...good, kind: 'audit_log' })).status()).toBe(400);
    expect((await post({ ...good, trip_id: '../../x' })).status()).toBe(400);
    expect((await post({ ...good, trip_id: '00000000-0000-4000-8000-000000000000' })).status()).toBe(404);
    const form = await page.request.post('/admin/api/export/', { form: { kind: 'members' }, headers: { Origin: origin }, maxRedirects: 0 });
    expect(form.status()).toBe(415);
    expect((await page.request.get('/admin/api/export/', { maxRedirects: 0 })).status()).toBe(405);
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
      `/admin/trips/${trip!.id}/photos/`,
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
