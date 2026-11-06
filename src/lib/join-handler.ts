/**
 * POST /api/join logic, written as a factory so tests can inject fetch,
 * the clock, config and the rate limiter. The route file wires real values.
 *
 * Flow: method → content-type → size → JSON → spam checks → rate limit →
 * validation (same rules as the browser) → forward to Apps Script with the
 * shared secret → generic JSON response. Internals are never leaked.
 */
import { z } from 'astro/zod';
import { getWilaya } from '../data/wilayas';
import { cleanName, normalizePhone, sanitizeCell, validateMembership, type FieldErrors } from './membership';

export const MAX_BODY_BYTES = 4096;
export const MIN_FILL_MS = 3000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

const PayloadSchema = z.object({
  fullName: z.string().max(200),
  phone: z.string().max(40),
  wilaya: z.string().max(4),
  age: z.union([z.string().max(4), z.number()]),
  consent: z.boolean(),
  lang: z.enum(['ar', 'en']),
  sourcePage: z.string().max(200).regex(/^\/[\w\-/]*$/).optional().default('/'),
  /** Honeypot: real people never see or fill this. */
  website: z.string().max(200).optional().default(''),
  /** Epoch ms when the form was rendered in the browser. */
  startedAt: z.number().int().nonnegative(),
});

export type JoinPayload = z.infer<typeof PayloadSchema>;

/** Row sent to Apps Script (which validates it again). */
export interface SheetRow {
  fullName: string;
  phone: string;
  wilayaCode: string;
  wilayaName: string;
  age: number;
  language: 'ar' | 'en';
  consent: true;
  sourcePage: string;
}

export interface JoinConfig {
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface RateLimiter {
  /** Returns false when this key has used up its attempts. */
  hit(key: string, now: number): boolean;
}

/** Best-effort in-memory limiter (per serverless instance): `max` hits per `windowMs`. */
export function createRateLimiter(max = 5, windowMs = 10 * 60 * 1000): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) hits.clear(); // keep memory bounded
      return true;
    },
  };
}

export interface JoinDeps {
  config: () => JoinConfig;
  fetch: typeof fetch;
  now: () => number;
  rateLimiter: RateLimiter;
  log?: (message: string, detail?: unknown) => void;
}

type ErrorBody = { ok: false; error: string; fields?: FieldErrors };

function json(status: number, body: { ok: true } | ErrorBody, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

function clientIp(request: Request, fallback?: string): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? fallback ?? 'unknown';
}

export function createJoinHandler(deps: JoinDeps) {
  const log = deps.log ?? (() => {});

  return async function handle(request: Request, clientAddress?: string): Promise<Response> {
    if (request.method !== 'POST') {
      return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
    }

    const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json') return json(415, { ok: false, error: 'unsupported_media_type' });

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: 'payload_too_large' });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: 'payload_too_large' });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json(400, { ok: false, error: 'invalid_json' });
    }
    const parsed = PayloadSchema.safeParse(raw);
    if (!parsed.success) return json(400, { ok: false, error: 'invalid_request' });
    const body = parsed.data;
    const now = deps.now();

    // Spam: honeypot filled, or submitted faster than a human could.
    const elapsed = now - body.startedAt;
    if (body.website.trim() !== '' || elapsed < MIN_FILL_MS || elapsed > MAX_FORM_AGE_MS) {
      log('join: rejected as spam', { honeypot: body.website !== '', elapsed });
      return json(400, { ok: false, error: 'rejected' });
    }

    if (!deps.rateLimiter.hit(clientIp(request, clientAddress), now)) {
      return json(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '600' });
    }

    const fields = validateMembership(body);
    if (Object.keys(fields).length > 0) return json(400, { ok: false, error: 'validation', fields });

    const { webhookUrl, webhookSecret } = deps.config();
    if (!webhookUrl || !webhookSecret) {
      log('join: SHEETS_WEBHOOK_URL / SHEETS_WEBHOOK_SECRET not configured');
      return json(503, { ok: false, error: 'unavailable' });
    }

    const wilaya = getWilaya(body.wilaya)!;
    // The phone is strictly normalised to +213XXXXXXXXX, so it can't carry a
    // formula. It starts with "+", so it is NOT run through sanitizeCell
    // (that would add an apostrophe); Apps Script writes it into a column
    // formatted as plain text instead.
    const row: SheetRow = {
      fullName: sanitizeCell(cleanName(body.fullName)),
      phone: normalizePhone(body.phone)!,
      wilayaCode: wilaya.code,
      wilayaName: sanitizeCell(`${wilaya.fr} / ${wilaya.ar}`),
      age: Number(body.age),
      language: body.lang,
      consent: true,
      sourcePage: sanitizeCell(body.sourcePage),
    };

    try {
      const upstream = await deps.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Apps Script answers with a 302 to googleusercontent.com; follow it.
        redirect: 'follow',
        body: JSON.stringify({ secret: webhookSecret, row }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = (await upstream.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!upstream.ok || !result?.ok) {
        log('join: upstream rejected', { status: upstream.status, error: result?.error });
        return json(502, { ok: false, error: 'upstream' });
      }
    } catch (error) {
      log('join: upstream request failed', error instanceof Error ? error.message : error);
      return json(502, { ok: false, error: 'upstream' });
    }

    return json(200, { ok: true });
  };
}
