import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJoinHandler, createRateLimiter, MAX_BODY_BYTES } from '../../src/lib/join-handler';

const NOW = 1_800_000_000_000;
const URL_ = 'https://script.google.com/macros/s/TEST/exec';
const SECRET = 'test-secret-value';

const valid = {
  fullName: 'Lina Benali',
  phone: '0661 23 45 67',
  wilaya: '05',
  age: '24',
  consent: true,
  lang: 'en',
  sourcePage: '/en/join/',
  website: '',
  startedAt: NOW - 10_000,
};

function req(body: unknown, init: { method?: string; type?: string; ip?: string; raw?: string } = {}) {
  const payload = init.raw ?? JSON.stringify(body);
  return new Request('https://fresh-move.vercel.app/api/join', {
    method: init.method ?? 'POST',
    headers: {
      'content-type': init.type ?? 'application/json',
      'x-forwarded-for': init.ip ?? '203.0.113.7',
    },
    body: (init.method ?? 'POST') === 'GET' ? undefined : payload,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let handle: ReturnType<typeof createJoinHandler>;

function setup(config = { webhookUrl: URL_, webhookSecret: SECRET }) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  handle = createJoinHandler({
    config: () => config,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => NOW,
    rateLimiter: createRateLimiter(5, 600_000),
  });
}

beforeEach(() => setup());

describe('POST /api/join', () => {
  it('valid payload → 200 and forwards the normalised row plus secret', async () => {
    const res = await handle(req(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(URL_);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('follow');
    expect(JSON.parse(init.body)).toEqual({
      secret: SECRET,
      row: {
        fullName: 'Lina Benali',
        phone: '+213661234567',
        wilayaCode: '05',
        wilayaName: 'Batna / باتنة',
        age: 24,
        language: 'en',
        consent: true,
        sourcePage: '/en/join/',
      },
    });
  });

  it('invalid payload → 400 with field errors, nothing forwarded', async () => {
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wrong shape / bad JSON → 400, nothing forwarded', async () => {
    expect((await handle(req({ hello: 'world' }))).status).toBe(400);
    expect((await handle(req(null, { raw: '{not json' }))).status).toBe(400);
    expect((await handle(req({ ...valid, sourcePage: 'javascript:alert(1)' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honeypot filled → rejected, nothing forwarded', async () => {
    const res = await handle(req({ ...valid, website: 'http://spam.example' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submitted too fast (< 3 s) → rejected, nothing forwarded', async () => {
    const res = await handle(req({ ...valid, startedAt: NOW - 1500 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('startedAt in the future or ancient → rejected', async () => {
    expect((await handle(req({ ...valid, startedAt: NOW + 60_000 }))).status).toBe(400);
    expect((await handle(req({ ...valid, startedAt: NOW - 3 * 86_400_000 }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('upstream failure → 502 with a generic message', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    let res = await handle(req(valid));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'upstream' });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'bad secret' }), { status: 200 }));
    res = await handle(req(valid, { ip: '198.51.100.1' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'upstream' }); // upstream detail is not leaked

    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    res = await handle(req(valid, { ip: '198.51.100.2' }));
    expect(res.status).toBe(502);
  });

  it('missing configuration → 503, nothing forwarded', async () => {
    setup({ webhookUrl: '', webhookSecret: '' });
    const res = await handle(req(valid));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wrong method → 405 with Allow header', async () => {
    const res = await handle(req(null, { method: 'GET' }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect((await handle(req(valid, { method: 'PUT' }))).status).toBe(405);
  });

  it('wrong content type → 415', async () => {
    const res = await handle(req(null, { type: 'application/x-www-form-urlencoded', raw: 'fullName=x' }));
    expect(res.status).toBe(415);
    expect((await handle(req(valid, { type: 'text/plain' }))).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a charset in the content type', async () => {
    expect((await handle(req(valid, { type: 'application/json; charset=utf-8' }))).status).toBe(200);
  });

  it('body over the size limit → 413', async () => {
    const res = await handle(req({ ...valid, fullName: 'x'.repeat(MAX_BODY_BYTES) }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits by IP → 429 after 5 attempts', async () => {
    for (let i = 0; i < 5; i++) expect((await handle(req(valid, { ip: '192.0.2.9' }))).status).toBe(200);
    const res = await handle(req(valid, { ip: '192.0.2.9' }));
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((await handle(req(valid, { ip: '192.0.2.10' }))).status).toBe(200);
  });

  it('responses are JSON and never cached', async () => {
    const res = await handle(req(valid));
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('never echoes the secret or webhook URL', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`failed ${URL_} ${SECRET}`));
    const text = await (await handle(req(valid))).text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('script.google.com');
  });
});
