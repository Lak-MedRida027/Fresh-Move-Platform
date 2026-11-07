import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, rateLimitKey, verifyTurnstileToken } from '../../src/lib/form-guard';
import { createJoinHandler, type MemberInput } from '../../src/lib/join-handler';

const NOW = 1_800_000_000_000;

const valid = {
  fullName: 'Lina  Benali',
  phone: '0661 23 45 67',
  wilaya: '05',
  age: '24',
  consent: true,
  lang: 'en',
  sourcePage: '/en/join/',
  website: '',
  startedAt: NOW - 10_000,
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
};

function req(body: unknown, init: { method?: string; type?: string; raw?: string } = {}) {
  const method = init.method ?? 'POST';
  return new Request('https://fresh-move.example/api/join', {
    method,
    headers: { 'content-type': init.type ?? 'application/json' },
    body: method === 'GET' ? undefined : (init.raw ?? JSON.stringify(body)),
  });
}

let saveMember: ReturnType<typeof vi.fn<(m: MemberInput) => Promise<void>>>;
let verifyTurnstile: ReturnType<typeof vi.fn<(token: string, ip: string) => Promise<boolean>>>;
let ipAllowed: boolean;
let phoneAllowed: boolean;
let limitIp: ReturnType<typeof vi.fn<(key: string) => Promise<boolean>>>;
let handle: ReturnType<typeof createJoinHandler>;

beforeEach(() => {
  saveMember = vi.fn(async () => {});
  verifyTurnstile = vi.fn(async () => true);
  ipAllowed = true;
  phoneAllowed = true;
  limitIp = vi.fn(async () => ipAllowed);
  handle = createJoinHandler({
    now: () => NOW,
    limitIp,
    limitPhone: async () => phoneAllowed,
    verifyTurnstile,
    saveMember,
  });
});

describe('POST /api/join', () => {
  it('valid payload → 200 and saves the normalised member', async () => {
    const res = await handle(req(valid), '203.0.113.7');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(saveMember).toHaveBeenCalledWith({
      fullName: 'Lina Benali',
      phone: '+213661234567',
      wilayaCode: '05',
      age: 24,
      consent: true,
    });
    expect(verifyTurnstile).toHaveBeenCalledWith('XXXX.DUMMY.TOKEN.XXXX', '203.0.113.7');
    expect(limitIp).toHaveBeenCalledWith('join:203.0.113.7');
  });

  it('invalid fields → 400 with field errors, nothing saved', async () => {
    const res = await handle(req({ ...valid, fullName: 'A', phone: '0851234567', wilaya: '70', age: '15', consent: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'validation',
      fields: {
        fullName: 'name.length',
        phone: 'phone.invalid',
        wilaya: 'wilaya.invalid',
        age: 'age.min',
        consent: 'consent.required',
      },
    });
    expect(saveMember).not.toHaveBeenCalled();
  });

  it('wrong shape / bad JSON → 400, nothing saved', async () => {
    expect((await handle(req({ hello: 'world' }))).status).toBe(400);
    expect((await handle(req(null, { raw: '{not json' }))).status).toBe(400);
    expect((await handle(req({ ...valid, sourcePage: 'javascript:alert(1)' }))).status).toBe(400);
    expect(saveMember).not.toHaveBeenCalled();
  });

  it('Turnstile failure → 400 captcha, nothing saved', async () => {
    verifyTurnstile.mockResolvedValueOnce(false);
    const res = await handle(req(valid));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'captcha' });
    expect(saveMember).not.toHaveBeenCalled();
  });

  it('honeypot filled → rejected before Turnstile, nothing saved', async () => {
    const res = await handle(req({ ...valid, website: 'http://spam.example' }));
    expect(await res.json()).toEqual({ ok: false, error: 'rejected' });
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(saveMember).not.toHaveBeenCalled();
  });

  it('too fast (< 3 s), future or ancient start time → rejected', async () => {
    for (const startedAt of [NOW - 1500, NOW + 60_000, NOW - 3 * 86_400_000]) {
      expect((await handle(req({ ...valid, startedAt }))).status).toBe(400);
    }
    expect(saveMember).not.toHaveBeenCalled();
  });

  it('per-IP rate limit → 429 before Turnstile', async () => {
    ipAllowed = false;
    const res = await handle(req(valid));
    expect(res.status).toBe(429);
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it('per-phone rate limit → 429, nothing saved', async () => {
    phoneAllowed = false;
    const res = await handle(req(valid));
    expect(res.status).toBe(429);
    expect(saveMember).not.toHaveBeenCalled();
  });

  it('database failure → 502 with a generic message (no details)', async () => {
    saveMember.mockRejectedValueOnce(new Error('PGRST connection refused at db.secret.host'));
    const res = await handle(req(valid));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: 'upstream' });
    expect(text).not.toContain('PGRST');
  });

  it('wrong method → 405 with Allow; wrong content type → 415', async () => {
    const r405 = await handle(req(null, { method: 'GET' }));
    expect(r405.status).toBe(405);
    expect(r405.headers.get('allow')).toBe('POST');
    expect((await handle(req(valid, { method: 'PUT' }))).status).toBe(405);
    expect((await handle(req(null, { type: 'application/x-www-form-urlencoded', raw: 'a=b' }))).status).toBe(415);
    expect((await handle(req(valid, { type: 'text/plain' }))).status).toBe(415);
    expect((await handle(req(valid, { type: 'application/json; charset=utf-8' }))).status).toBe(200);
  });

  it('body over the size limit → 413 (also when streamed without Content-Length)', async () => {
    expect((await handle(req({ ...valid, fullName: 'x'.repeat(MAX_BODY_BYTES) }))).status).toBe(413);
    const big = new TextEncoder().encode(JSON.stringify({ ...valid, fullName: 'x'.repeat(MAX_BODY_BYTES * 4) }));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled >= big.length) return c.close();
        c.enqueue(big.slice(pulled, pulled + 1024));
        pulled += 1024;
      },
    });
    const r = new Request('https://x/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect((await handle(r)).status).toBe(413);
    expect(pulled).toBeLessThan(big.length);
    expect(saveMember).not.toHaveBeenCalled();
  });

  it('responses are JSON and never cached', async () => {
    const res = await handle(req(valid));
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('form guard helpers', () => {
  it('rate-limit key prefers the platform address over headers', () => {
    const r = new Request('https://x/', { headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9', 'cf-connecting-ip': '198.51.100.4' } });
    expect(rateLimitKey(r, '192.0.2.1')).toBe('192.0.2.1');
    expect(rateLimitKey(r)).toBe('198.51.100.4');
    expect(rateLimitKey(new Request('https://x/', { headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' } }))).toBe('203.0.113.9');
    expect(rateLimitKey(new Request('https://x/'))).toBe('unknown');
  });

  it('verifyTurnstileToken posts secret + token to siteverify and reads success', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get('secret')).toBe('s3cret');
      expect(form.get('response')).toBe('tok');
      expect(form.get('remoteip')).toBe('203.0.113.7');
      return new Response(JSON.stringify({ success: true }));
    });
    expect(await verifyTurnstileToken('s3cret', 'tok', '203.0.113.7', fetchMock as unknown as typeof fetch)).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });

  it('verifyTurnstileToken fails closed', async () => {
    const no = vi.fn(async () => new Response(JSON.stringify({ success: false })));
    const boom = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await verifyTurnstileToken('s', 'tok', 'ip', no as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstileToken('s', 'tok', 'ip', boom as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstileToken('s', '', 'ip', no as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstileToken('', 'tok', 'ip', no as unknown as typeof fetch)).toBe(false);
  });

  it("Cloudflare's test secrets are answered locally, the same way siteverify answers them", async () => {
    const net = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    const f = net as unknown as typeof fetch;
    expect(await verifyTurnstileToken('1x0000000000000000000000000000000AA', 'XXXX.DUMMY.TOKEN.XXXX', 'ip', f)).toBe(true);
    expect(await verifyTurnstileToken('1x0000000000000000000000000000000AA', 'a-real-looking-token', 'ip', f)).toBe(false);
    expect(await verifyTurnstileToken('2x0000000000000000000000000000000AA', 'XXXX.DUMMY.TOKEN.XXXX', 'ip', f)).toBe(false);
    expect(await verifyTurnstileToken('3x0000000000000000000000000000000AA', 'XXXX.DUMMY.TOKEN.XXXX', 'ip', f)).toBe(false);
    expect(net).not.toHaveBeenCalled();
    // A real secret still goes to Cloudflare, even with the dummy token.
    expect(await verifyTurnstileToken('real-secret', 'XXXX.DUMMY.TOKEN.XXXX', 'ip', f)).toBe(true);
    expect(net).toHaveBeenCalledOnce();
  });
});
