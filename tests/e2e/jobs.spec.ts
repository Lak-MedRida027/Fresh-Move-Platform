/**
 * Scheduled jobs through the manual endpoint (same code as the cron triggers),
 * on the built Worker. API-only: one browser project is enough.
 */
import { expect, test } from '@playwright/test';
import { E2E, localDb, readVars } from './fixtures';

const SECRET = { ...readVars('.env'), ...readVars('.dev.vars') }.CRON_SECRET ?? '';

test.describe('cron jobs', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({ request: _ }, info) => test.skip(info.project.name !== 'desktop-chrome', 'API checks, one browser is enough'));

  test('manual runs need the secret', async ({ request }) => {
    expect(SECRET.length).toBeGreaterThanOrEqual(32);
    const post = (job: string, auth?: string) =>
      request.post(`/api/cron/${job}`, { headers: auth ? { Authorization: auth } : {}, maxRedirects: 0 });
    const none = await post('frequent');
    expect(none.status()).toBe(401);
    expect(none.headers()['www-authenticate']).toBe('Bearer');
    expect((await post('frequent', `Bearer ${SECRET}x`)).status()).toBe(401);
    expect((await post('frequent', SECRET)).status()).toBe(401);
    expect((await post('nope', `Bearer ${SECRET}`)).status()).toBe(404);
    expect((await request.get('/api/cron/frequent', { headers: { Authorization: `Bearer ${SECRET}` } })).status()).toBe(405);
  });

  test('frequent: an unpaid hold whose time is up becomes expired', async ({ request }) => {
    const db = localDb();
    const { data: trip } = await db.from('trips').select('id').eq('slug', E2E.open).single();
    const phone = `+2136${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const { data: r, error } = await db.rpc('reserve_seat', {
      p_trip_id: trip!.id, p_full_name: 'Zz Expiring Hold', p_phone: phone, p_wilaya_code: '16', p_age: 25, p_consent: true,
    });
    expect(error).toBeNull();
    const code = (r as { code: string }).code;
    await db.from('reservations').update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('code', code);

    const res = await request.post('/api/cron/frequent', { headers: { Authorization: `Bearer ${SECRET}` } });
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, job: 'frequent' });
    expect(body.result.expired).toBeGreaterThanOrEqual(1);
    const { data: after } = await db.from('reservations').select('status').eq('code', code).single();
    expect(after!.status).toBe('expired');

    const { data: run } = await db.from('job_runs').select('*').eq('job', 'frequent').single();
    expect(run).toMatchObject({ ok: true, error: null });
    expect(Date.now() - Date.parse(run!.finished_at!)).toBeLessThan(60_000);
  });

  test('daily: retention, orphan files and keep-alive, recorded for the overview', async ({ request }) => {
    const res = await request.post('/api/cron/daily', { headers: { Authorization: `Bearer ${SECRET}` } });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(Object.keys(body.result).sort()).toEqual(['anonymised', 'audit_redacted', 'keep_alive', 'orphans_removed', 'rate_limits_deleted']);
    const { data: run } = await localDb().from('job_runs').select('ok, result').eq('job', 'daily').single();
    expect(run).toMatchObject({ ok: true, result: body.result });
  });
});
