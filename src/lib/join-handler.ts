/**
 * POST /api/join: membership form → Supabase `join_member()` (upsert by phone,
 * never overwrites with empty values). Factory with injected deps for tests;
 * src/pages/api/join.ts wires the real ones.
 */
import { z } from 'astro/zod';
import { guardPublicForm, json, type GuardDeps } from './form-guard';
import { cleanName, normalizePhone, validateMembership } from './membership';

export { MAX_BODY_BYTES } from './form-guard';

const JoinSchema = z.object({
  fullName: z.string().max(200),
  phone: z.string().max(40),
  wilaya: z.string().max(4),
  age: z.union([z.string().max(4), z.number()]),
  consent: z.boolean(),
  lang: z.enum(['ar', 'en']),
  sourcePage: z.string().max(200).regex(/^\/[\w\-/]*$/).optional().default('/'),
});

export interface MemberInput {
  fullName: string;
  phone: string; // +213XXXXXXXXX
  wilayaCode: string;
  age: number;
  consent: true;
}

export interface JoinDeps extends GuardDeps {
  /** Strict per-phone limit (database). true = allowed. */
  limitPhone: (phone: string) => Promise<boolean>;
  /** Saves the member; throws on failure. */
  saveMember: (member: MemberInput) => Promise<void>;
}

export function createJoinHandler(deps: JoinDeps) {
  const log = deps.log ?? (() => {});
  return async function handle(request: Request, clientAddress?: string): Promise<Response> {
    const guard = await guardPublicForm(request, clientAddress, JoinSchema, deps, 'join');
    if (!guard.ok) return guard.response;
    const body = guard.body;

    const fields = validateMembership(body);
    if (Object.keys(fields).length > 0) return json(400, { ok: false, error: 'validation', fields });

    const phone = normalizePhone(body.phone)!;
    if (!(await deps.limitPhone(phone))) {
      return json(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '600' });
    }

    try {
      await deps.saveMember({
        fullName: cleanName(body.fullName),
        phone,
        wilayaCode: body.wilaya,
        age: Number(body.age),
        consent: true,
      });
    } catch (error) {
      log('join: save failed', error instanceof Error ? error.message : 'unknown');
      return json(502, { ok: false, error: 'upstream' });
    }
    return json(200, { ok: true });
  };
}
