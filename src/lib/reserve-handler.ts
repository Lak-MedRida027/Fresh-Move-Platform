/**
 * POST /api/reserve: reserve a seat (or a waitlist place) on an upcoming trip.
 * Guard (method, type, size, honeypot, time, per-IP, Turnstile) → validation →
 * per-phone limit → reserve_seat() in the database (seat logic under a lock).
 */
import { z } from 'astro/zod';
import { guardPublicForm, json, type GuardDeps } from './form-guard';
import { cleanName, normalizePhone, validateMembership } from './membership';

const ReserveSchema = z.object({
  tripId: z.uuid(),
  fullName: z.string().max(200),
  phone: z.string().max(40),
  wilaya: z.string().max(4),
  age: z.union([z.string().max(4), z.number()]),
  consent: z.boolean(),
  lang: z.enum(['ar', 'en']),
  sourcePage: z.string().max(200).regex(/^\/[\w\-/]*$/).optional().default('/'),
});

export interface ReserveInput {
  tripId: string;
  fullName: string;
  phone: string;
  wilayaCode: string;
  age: number;
  consent: true;
}

export interface ReserveResult {
  code: string;
  status: 'pending' | 'waitlist' | 'confirmed';
  hold_expires_at: string | null;
  seats_left: number;
  existing: boolean;
}

/** Thrown by `reserve` with the database's error code (e.g. 'trip_not_open'). */
export class ReserveError extends Error {}

export interface ReserveDeps extends GuardDeps {
  limitPhone: (phone: string) => Promise<boolean>;
  reserve: (input: ReserveInput) => Promise<ReserveResult>;
}

const CLOSED = new Set(['trip_not_open', 'registration_closed', 'trip_past']);

export function createReserveHandler(deps: ReserveDeps) {
  const log = deps.log ?? (() => {});
  return async function handle(request: Request, clientAddress?: string): Promise<Response> {
    const guard = await guardPublicForm(request, clientAddress, ReserveSchema, deps, 'reserve');
    if (!guard.ok) return guard.response;
    const body = guard.body;

    const fields = validateMembership(body);
    if (Object.keys(fields).length > 0) return json(400, { ok: false, error: 'validation', fields });

    const phone = normalizePhone(body.phone)!;
    if (!(await deps.limitPhone(phone))) {
      return json(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '600' });
    }

    try {
      const r = await deps.reserve({
        tripId: body.tripId,
        fullName: cleanName(body.fullName),
        phone,
        wilayaCode: body.wilaya,
        age: Number(body.age),
        consent: true,
      });
      // Already booked: never reveal that booking's code, status or hold to an
      // unauthenticated caller (anyone can type someone else's phone number).
      if (r.existing) return json(200, { ok: true, existing: true });
      return json(200, {
        ok: true,
        code: r.code,
        status: r.status,
        holdExpiresAt: r.hold_expires_at,
        seatsLeft: r.seats_left,
        existing: r.existing,
      });
    } catch (error) {
      const code = error instanceof ReserveError ? error.message : 'unknown';
      if (code === 'trip_not_found') return json(404, { ok: false, error: 'not_found' });
      if (CLOSED.has(code)) return json(409, { ok: false, error: 'closed' });
      if (code === 'too_many_pending') return json(409, { ok: false, error: 'too_many_pending' });
      if (code === 'invalid_input' || code === 'consent_required') return json(400, { ok: false, error: 'invalid_request' });
      log('reserve: failed', code);
      return json(502, { ok: false, error: 'upstream' });
    }
  };
}
