import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReserveHandler, ReserveError, type ReserveInput, type ReserveResult } from '../../src/lib/reserve-handler';
import { createStatusHandler, type StatusResult } from '../../src/lib/status-handler';

const NOW = 1_800_000_000_000;
const TRIP = '7b1b4d3e-2a7c-4c8e-9f8e-6a2f2a3b4c5d';
const guard = { website: '', startedAt: NOW - 10_000, turnstileToken: 'tok' };

const post = (url: string, body: unknown, init: { method?: string; type?: string; raw?: string } = {}) =>
  new Request(`https://fresh-move.example${url}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': init.type ?? 'application/json' },
    body: (init.method ?? 'POST') === 'GET' ? undefined : (init.raw ?? JSON.stringify(body)),
  });

describe('POST /api/reserve', () => {
  const valid = {
    tripId: TRIP,
    fullName: 'Yacine Haddad',
    phone: '0770 11 22 33',
    wilaya: '19',
    age: 27,
    consent: true,
    lang: 'ar',
    sourcePage: '/trips/chelia-summit/',
    ...guard,
  };
  let reserve: ReturnType<typeof vi.fn<(i: ReserveInput) => Promise<ReserveResult>>>;
  let verifyTurnstile: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let ipOk: boolean;
  let phoneOk: boolean;
  let handle: ReturnType<typeof createReserveHandler>;

  beforeEach(() => {
    ipOk = true;
    phoneOk = true;
    verifyTurnstile = vi.fn(async () => true);
    reserve = vi.fn(async () => ({
      code: 'FM-7K3QX',
      status: 'pending' as const,
      hold_expires_at: '2026-11-16T17:00:00Z',
      seats_left: 4,
      existing: false,
    }));
    handle = createReserveHandler({
      now: () => NOW,
      limitIp: async () => ipOk,
      limitPhone: async () => phoneOk,
      verifyTurnstile,
      reserve,
    });
  });

  it('valid → 200 with code, status, hold and seats left; normalised input', async () => {
    const res = await handle(post('/api/reserve', valid), '203.0.113.5');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      code: 'FM-7K3QX',
      status: 'pending',
      holdExpiresAt: '2026-11-16T17:00:00Z',
      seatsLeft: 4,
      existing: false,
    });
    expect(reserve).toHaveBeenCalledWith({
      tripId: TRIP,
      fullName: 'Yacine Haddad',
      phone: '+213770112233',
      wilayaCode: '19',
      age: 27,
      consent: true,
    });
  });

  it('waitlist reservations are passed through', async () => {
    reserve.mockResolvedValueOnce({ code: 'FM-ABCDE', status: 'waitlist', hold_expires_at: null, seats_left: 0, existing: false });
    const body = await (await handle(post('/api/reserve', valid))).json();
    expect(body).toMatchObject({ status: 'waitlist', existing: false, code: 'FM-ABCDE' });
  });

  it('an existing booking is acknowledged without revealing its code, status or hold', async () => {
    reserve.mockResolvedValueOnce({ code: 'FM-ABCDE', status: 'pending', hold_expires_at: '2026-11-16T17:00:00Z', seats_left: 3, existing: true });
    const res = await handle(post('/api/reserve', valid));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, existing: true });
    expect(text).not.toContain('FM-ABCDE');
  });

  it('validation errors → 400 with fields; nothing reserved', async () => {
    const res = await handle(post('/api/reserve', { ...valid, phone: '0123', age: 12 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation', fields: { phone: 'phone.invalid', age: 'age.min' } });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('bad trip id → 400 invalid_request', async () => {
    expect((await handle(post('/api/reserve', { ...valid, tripId: 'not-a-uuid' }))).status).toBe(400);
    expect(reserve).not.toHaveBeenCalled();
  });

  it('Turnstile failure → 400 captcha, nothing reserved', async () => {
    verifyTurnstile.mockResolvedValueOnce(false);
    const res = await handle(post('/api/reserve', valid));
    expect(await res.json()).toEqual({ ok: false, error: 'captcha' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('honeypot / too fast → rejected', async () => {
    expect(await (await handle(post('/api/reserve', { ...valid, website: 'x' }))).json()).toMatchObject({ error: 'rejected' });
    expect(await (await handle(post('/api/reserve', { ...valid, startedAt: NOW - 500 }))).json()).toMatchObject({ error: 'rejected' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rate limits per IP and per phone → 429', async () => {
    ipOk = false;
    expect((await handle(post('/api/reserve', valid))).status).toBe(429);
    ipOk = true;
    phoneOk = false;
    expect((await handle(post('/api/reserve', valid))).status).toBe(429);
    expect(reserve).not.toHaveBeenCalled();
  });

  it.each([
    ['trip_not_open', 409, 'closed'],
    ['registration_closed', 409, 'closed'],
    ['trip_past', 409, 'closed'],
    ['too_many_pending', 409, 'too_many_pending'],
    ['trip_not_found', 404, 'not_found'],
    ['invalid_input', 400, 'invalid_request'],
    ['rpc_failed', 502, 'upstream'],
  ])('database error %s → %i %s', async (code, status, error) => {
    reserve.mockRejectedValueOnce(new ReserveError(code));
    const res = await handle(post('/api/reserve', valid));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error });
  });

  it('unexpected exceptions → 502 without details', async () => {
    reserve.mockRejectedValueOnce(new Error('connect ECONNREFUSED db.internal'));
    const res = await handle(post('/api/reserve', valid));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('ECONNREFUSED');
  });

  it('wrong method / content type → 405 / 415', async () => {
    expect((await handle(post('/api/reserve', null, { method: 'GET' }))).status).toBe(405);
    expect((await handle(post('/api/reserve', valid, { type: 'text/plain' }))).status).toBe(415);
  });
});

describe('POST /api/status', () => {
  const valid = { phone: '0770112233', code: 'fm 7k3qx', lang: 'en', ...guard };
  const found: StatusResult = {
    code: 'FM-7K3QX',
    status: 'pending',
    hold_expires_at: '2026-11-16T17:00:00Z',
    trip: { slug: 'chelia-summit', title_ar: 'قمة شيليا', title_en: 'Chelia summit', start_date: '2026-11-20', end_date: '2026-11-21', status: 'open' },
  };
  let lookup: ReturnType<typeof vi.fn<(phone: string, code: string) => Promise<StatusResult | null>>>;
  let limits: string[];
  let limitOk: boolean;
  let handle: ReturnType<typeof createStatusHandler>;

  beforeEach(() => {
    limits = [];
    limitOk = true;
    lookup = vi.fn(async () => found);
    handle = createStatusHandler({
      now: () => NOW,
      limitIp: async () => true,
      verifyTurnstile: async () => true,
      limit: async (key) => {
        limits.push(key);
        return limitOk;
      },
      lookup,
    });
  });

  it('phone + code → 200 with status, hold and trip; inputs normalised', async () => {
    const res = await handle(post('/api/status', valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      reservation: {
        code: 'FM-7K3QX',
        status: 'pending',
        holdExpiresAt: '2026-11-16T17:00:00Z',
        trip: { slug: 'chelia-summit', title: { ar: 'قمة شيليا', en: 'Chelia summit' }, startDate: '2026-11-20', endDate: '2026-11-21' },
      },
    });
    expect(lookup).toHaveBeenCalledWith('+213770112233', 'FM-7K3QX');
    expect(limits).toEqual(['status:phone:+213770112233', 'status:code:FM-7K3QX']);
  });

  it('wrong phone and wrong code get the same generic 404', async () => {
    lookup.mockResolvedValue(null);
    const a = await handle(post('/api/status', { ...valid, phone: '0661000000' }));
    const b = await handle(post('/api/status', { ...valid, code: 'FM-ZZZZZ' }));
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
  });

  it('malformed phone or code → 400 validation (format only, no lookup)', async () => {
    const res = await handle(post('/api/status', { ...valid, phone: '12', code: 'FM-0000' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: { phone: 'phone.invalid', code: 'code.invalid' } });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('per-phone / per-code limit → 429, no lookup', async () => {
    limitOk = false;
    expect((await handle(post('/api/status', valid))).status).toBe(429);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('lookup failure → 502 generic', async () => {
    lookup.mockRejectedValueOnce(new Error('boom'));
    const res = await handle(post('/api/status', valid));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'upstream' });
  });

  it('wrong method / content type → 405 / 415', async () => {
    expect((await handle(post('/api/status', null, { method: 'GET' }))).status).toBe(405);
    expect((await handle(post('/api/status', valid, { type: 'text/plain' }))).status).toBe(415);
  });
});
