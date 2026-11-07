/**
 * Admin accounts end to end: invitation email → choose a password → set up
 * MFA; then "forgot password" → email → MFA code → new password. Emails are
 * read from the local stack's mail catcher (Mailpit). One browser is enough.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { totp } from '../totp';
import { localDb, readAdmins, readVars } from './fixtures';

const MAILPIT = 'http://127.0.0.1:54324';

/** Newest email to `to` whose subject matches, after `since` (polls up to 20 s). */
async function emailLink(to: string, subject: RegExp, since: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages = [] } = (await res.json()) as { messages?: { ID: string; Subject: string; Created: string }[] };
    const msg = messages.find((m) => subject.test(m.Subject) && Date.parse(m.Created) >= since - 2000);
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { HTML: string };
      // The English link (the email has Darja first, then English).
      const href = /href="([^"]*\/en\/admin\/auth\/confirm\/[^"]*)"/.exec(full.HTML)?.[1];
      if (!href) throw new Error('no confirm link in the email');
      return href.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no "${subject}" email for ${to}`);
}

/** A TOTP code different from the ones already used (Supabase refuses a code twice). */
async function freshCode(secret: string, used: Set<string>): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const code = totp(secret);
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('no fresh TOTP code');
}

async function setPassword(page: Page, password: string, repeat = password) {
  await page.locator('#pw-new').fill(password);
  await page.locator('#pw-repeat').fill(repeat);
  await page.locator('[data-password-form] button[type="submit"]').click();
}

/** The owner, signed in: reuses the admin tests' saved session when it's still valid. */
async function ownerPage(browser: import('@playwright/test').Browser): Promise<Page> {
  const owner = readAdmins('desktop-chrome').owner;
  const context = await browser.newContext();
  const saved = '.playwright/session-desktop-chrome-owner.json';
  if (existsSync(saved)) await context.addCookies(JSON.parse(readFileSync(saved, 'utf8')));
  const page = await context.newPage();
  await page.goto('/en/admin/');
  if (/\/en\/admin\/$/.test(page.url())) return page;
  await page.goto('/en/admin/login/');
  await page.locator('#login-email').fill(owner.email);
  await page.locator('#login-password').fill(owner.password);
  await page.locator('[data-login-form] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/en\/admin\/mfa\/$/);
  await page.locator('#mfa-code').fill(totp(owner.totpSecret!));
  await page.locator('form[action="/admin/api/mfa/"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/en\/admin\/$/);
  return page;
}

test.describe('admin accounts', () => {
  test.beforeEach(({ request: _ }, info) => test.skip(info.project.name !== 'desktop-chrome', 'email flows: one browser is enough'));

  test('invitation → password → MFA; forgot password → email → MFA code → new password', async ({ browser }) => {
    test.setTimeout(150_000);
    const email = `e2e-invite-${Date.now().toString(36)}@example.test`;
    const used = new Set<string>();
    const db = localDb();
    try {
      // The owner invites a new organiser.
      const owner = await ownerPage(browser);
      const sentAt = Date.now();
      await owner.goto('/en/admin/admins/');
      await owner.locator('#inv-email').fill(email);
      await owner.locator('#inv-name').fill('Zz Invited');
      await owner.locator('#inv-role').selectOption('organizer');
      await owner.locator('form:has(#inv-email) button[type="submit"]').click();
      await expect(owner.locator('[data-flash="ok"]')).toHaveText('Invitation sent ✓');
      await owner.context().close();

      // The invitee opens the email link in their own browser.
      const link = await emailLink(email, /choose your password/i, sentAt);
      expect(new URL(link).pathname).toBe('/en/admin/auth/confirm/');
      const page = await (await browser.newContext()).newPage();
      await page.goto(link);
      await expect(page.locator('h1')).toHaveText('Welcome to the Fresh Move admin');
      await page.locator('[data-confirm-form] button[type="submit"]').click();
      await expect(page).toHaveURL(/\/en\/admin\/password\/$/);

      // Passwords must match (length is checked by the browser and the server), then MFA enrolment.
      await setPassword(page, 'a long enough sentence 1', 'a different sentence 22');
      await expect(page.locator('[data-flash="error"]')).toHaveText('The two passwords aren’t the same.');
      const first = `Zz first quiet desert ${Date.now()}`;
      await setPassword(page, first);
      await expect(page).toHaveURL(/\/en\/admin\/mfa\/$/);
      await expect(page.locator('h1')).toHaveText('Set up two-step verification');
      const secret = (await page.locator('[data-totp-secret]').textContent())!.trim();
      await page.locator('#mfa-code').fill(await freshCode(secret, used));
      await page.locator('form[action="/admin/api/mfa/"] button[type="submit"]').click();
      await expect(page).toHaveURL(/\/en\/admin\/$/);
      await expect(page.locator('h1')).toHaveText('Overview');
      await page.context().close();

      // A used link doesn't work twice.
      const again = await (await browser.newContext()).newPage();
      await again.goto(link);
      await again.locator('[data-confirm-form] button[type="submit"]').click();
      await expect(again).toHaveURL(/\/en\/admin\/login\/\?error=link$/);

      // Forgot password: the same answer for unknown addresses as for real ones.
      await again.getByRole('link', { name: 'Forgot your password?' }).click();
      await again.locator('#forgot-email').fill(`nobody-${Date.now()}@example.test`);
      await again.locator('[data-forgot-form] button[type="submit"]').click();
      const sentText = await again.locator('[data-forgot-sent]').textContent();
      const resetAt = Date.now();
      await again.goto('/en/admin/forgot/');
      await again.locator('#forgot-email').fill(email);
      await again.locator('[data-forgot-form] button[type="submit"]').click();
      await expect(again.locator('[data-forgot-sent]')).toHaveText(sentText!);
      await again.context().close();

      // The reset link needs the MFA code before a new password can be set.
      const reset = await emailLink(email, /reset your password/i, resetAt);
      const r = await (await browser.newContext()).newPage();
      await r.goto(reset);
      await expect(r.locator('h1')).toHaveText('Reset your password');
      await r.locator('[data-confirm-form] button[type="submit"]').click();
      await expect(r).toHaveURL(/\/en\/admin\/mfa\/\?next=password$/);
      await expect(r.locator('h1')).not.toHaveText('Set up two-step verification');
      await r.locator('#mfa-code').fill(await freshCode(secret, used));
      await r.locator('form[action="/admin/api/mfa/"] button[type="submit"]').click();
      await expect(r).toHaveURL(/\/en\/admin\/password\/$/);
      await setPassword(r, first);
      await expect(r.locator('[data-flash="error"]')).toHaveText('That’s already your password. Choose a new one.');
      const second = `Zz second mountain trail ${Date.now()}`;
      await setPassword(r, second);
      await expect(r).toHaveURL(/\/en\/admin\/\?ok=password$/);
      await expect(r.locator('[data-flash="ok"]')).toHaveText('Password changed ✓');
      await r.context().close();

      // The new password works, the old one doesn't.
      const env = readVars('.env');
      const anon = () => createClient(env.PUBLIC_SUPABASE_URL!, env.PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      expect((await anon().auth.signInWithPassword({ email, password: second })).error).toBeNull();
      expect((await anon().auth.signInWithPassword({ email, password: first })).error).not.toBeNull();
    } finally {
      const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
      const u = data.users.find((x) => x.email === email);
      if (u) await db.auth.admin.deleteUser(u.id);
    }
  });

  test('bad links and direct calls are refused', async ({ page, request }) => {
    await page.goto('/en/admin/auth/confirm/?type=invite&token_hash=short');
    await expect(page.locator('[role="alert"]')).toContainText('isn’t valid any more');
    await page.goto(`/en/admin/auth/confirm/?type=signup&token_hash=${'a'.repeat(56)}`);
    await expect(page.locator('[data-confirm-form]')).toHaveCount(0);
    // A well-formed but unknown token.
    await page.goto(`/en/admin/auth/confirm/?type=recovery&token_hash=${'b'.repeat(56)}`);
    await page.locator('[data-confirm-form] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/en\/admin\/login\/\?error=link$/);
    await expect(page.locator('[data-flash="error"]')).toContainText('isn’t valid any more');
    // Choosing a password needs a session.
    const res = await request.post('/admin/api/password/', { form: { password: 'x'.repeat(20), password_repeat: 'x'.repeat(20) }, maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect((await request.get('/en/admin/password/', { maxRedirects: 0 })).status()).toBe(303);
  });
});
