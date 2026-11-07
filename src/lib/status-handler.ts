/**
 * POST /api/status: "check my reservation" with phone + code. A wrong phone
 * and a wrong code get the exact same 404, so nothing leaks. Limited per IP
 * (binding) and per phone and per code (database).
 */
import { z } from 'astro/zod';
import { guardPublicForm, json, type GuardDeps } from './form-guard';
import { validatePhone, normalizePhone } from './membership';
import { normalizeCode } from './reservation-code';

const StatusSchema = z.object({
  phone: z.string().max(40),
  code: z.string().max(20),
  lang: z.enum(['ar', 'en']).optional(),
});

export interface StatusResult {
  code: string;
  status: string;
  hold_expires_at: string | null;
  trip: { slug: string; title_ar: string; title_en: string; start_date: string | null; end_date: string | null; status: string };
}

export interface StatusDeps extends GuardDeps {
  /** Strict limiter (database) for a key like "status:phone:+213…". true = allowed. */
  limit: (key: string) => Promise<boolean>;
  lookup: (phone: string, code: string) => Promise<StatusResult | null>;
}

export function createStatusHandler(deps: StatusDeps) {
  const log = deps.log ?? (() => {});
  return async function handle(request: Request, clientAddress?: string): Promise<Response> {
    const guard = await guardPublicForm(request, clientAddress, StatusSchema, deps, 'status');
    if (!guard.ok) return guard.response;
    const { body } = guard;

    const fields: Record<string, string> = {};
    const phoneError = validatePhone(body.phone);
    if (phoneError) fields.phone = phoneError;
    const code = normalizeCode(body.code);
    if (!code) fields.code = body.code.trim() ? 'code.invalid' : 'required';
    if (Object.keys(fields).length) return json(400, { ok: false, error: 'validation', fields });

    const phone = normalizePhone(body.phone)!;
    const allowed = (await deps.limit(`status:phone:${phone}`)) && (await deps.limit(`status:code:${code}`));
    if (!allowed) return json(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '600' });

    try {
      const found = await deps.lookup(phone, code!);
      if (!found) return json(404, { ok: false, error: 'not_found' });
      return json(200, {
        ok: true,
        reservation: {
          code: found.code,
          status: found.status,
          holdExpiresAt: found.hold_expires_at,
          trip: {
            slug: found.trip.slug,
            title: { ar: found.trip.title_ar, en: found.trip.title_en },
            startDate: found.trip.start_date,
            endDate: found.trip.end_date,
          },
        },
      });
    } catch (error) {
      log('status: lookup failed', error instanceof Error ? error.message : 'unknown');
      return json(502, { ok: false, error: 'upstream' });
    }
  };
}
