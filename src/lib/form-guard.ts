/**
 * Shared front door for public form endpoints (/api/join, /api/reserve,
 * /api/status). In order: method → content type → size (streamed) → JSON →
 * shape → honeypot + minimum fill time → per-IP rate limit → Turnstile.
 * Responses are generic JSON; details only go to the server log (no personal data).
 */
import { z } from 'astro/zod';

export const MAX_BODY_BYTES = 4096;
export const MIN_FILL_MS = 3000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

export interface GuardDeps {
  now: () => number;
  /** Cloudflare Rate Limiting binding (approximate, per location). true = allowed. */
  limitIp: (key: string) => Promise<boolean>;
  verifyTurnstile: (token: string, ip: string) => Promise<boolean>;
  log?: (message: string, detail?: unknown) => void;
}

export type ErrorBody = { ok: false; error: string; fields?: Record<string, string> };

export function json(status: number, body: object, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/** Spam / anti-bot fields every public form sends. */
export const GuardFields = z.object({
  /** Honeypot: real people never see or fill this. */
  website: z.string().max(200).optional().default(''),
  /** Epoch ms when the form was rendered in the browser. */
  startedAt: z.number().int().nonnegative(),
  /** Cloudflare Turnstile token. */
  turnstileToken: z.string().max(2048).optional().default(''),
});

/**
 * Rate-limit key. Prefer the address the platform gives us (Astro's
 * clientAddress, from Cloudflare's CF-Connecting-IP). Headers are a fallback;
 * a client-sent X-Forwarded-For list is never trusted beyond its last entry.
 */
export function rateLimitKey(request: Request, clientAddress?: string): string {
  if (clientAddress) return clientAddress;
  const cf = request.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const last = request.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
  return last || 'unknown';
}

/** Reads the body up to `limit` bytes; null as soon as it goes over. */
export async function readLimited(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export type GuardResult<T> = { ok: true; body: T; ip: string } | { ok: false; response: Response };

export async function guardPublicForm<S extends z.ZodType>(
  request: Request,
  clientAddress: string | undefined,
  schema: S,
  deps: GuardDeps,
  name: string,
): Promise<GuardResult<z.infer<S> & z.infer<typeof GuardFields>>> {
  const log = deps.log ?? (() => {});
  const fail = (status: number, error: string, extra?: Record<string, string>) =>
    ({ ok: false, response: json(status, { ok: false, error }, extra) }) as const;

  if (request.method !== 'POST') return fail(405, 'method_not_allowed', { Allow: 'POST' });
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') return fail(415, 'unsupported_media_type');
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return fail(413, 'payload_too_large');
  const text = await readLimited(request, MAX_BODY_BYTES);
  if (text === null) return fail(413, 'payload_too_large');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(400, 'invalid_json');
  }
  const parsed = schema.and(GuardFields).safeParse(raw);
  if (!parsed.success) return fail(400, 'invalid_request');
  const body = parsed.data as z.infer<S> & z.infer<typeof GuardFields>;

  const elapsed = deps.now() - body.startedAt;
  if (body.website.trim() !== '' || elapsed < MIN_FILL_MS || elapsed > MAX_FORM_AGE_MS) {
    log(`${name}: rejected as spam`, { honeypot: body.website !== '', elapsed });
    return fail(400, 'rejected');
  }

  const ip = rateLimitKey(request, clientAddress);
  if (!(await deps.limitIp(`${name}:${ip}`))) return fail(429, 'rate_limited', { 'Retry-After': '60' });

  if (!(await deps.verifyTurnstile(body.turnstileToken, ip))) {
    log(`${name}: turnstile failed`);
    return fail(400, 'captcha');
  }
  return { ok: true, body, ip };
}

/**
 * Cloudflare's published test secret keys have fixed answers
 * (https://developers.cloudflare.com/turnstile/troubleshooting/testing/): the
 * "always passes" secret accepts only the dummy token the test site keys
 * produce, the others always fail. Answering them here gives the same result
 * without a network call, so local runs and tests don't depend on reaching
 * Cloudflare. Real secrets always go to siteverify.
 */
export const TEST_SECRET_PASS = '1x0000000000000000000000000000000AA';
export const TEST_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const TEST_SECRETS_FAIL = new Set(['2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']);

/** Server-side Turnstile check (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). */
export async function verifyTurnstileToken(
  secret: string,
  token: string,
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret || !token || token.length > 2048) return false;
  if (secret === TEST_SECRET_PASS) return token === TEST_DUMMY_TOKEN;
  if (TEST_SECRETS_FAIL.has(secret)) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
