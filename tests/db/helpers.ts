/**
 * Helpers for database tests. They run ONLY against the local Supabase stack
 * (see scripts/with-local-supabase.mjs); a guard refuses any other host.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { totp } from '../totp';

export { totp };

export type DB = SupabaseClient<Database>;

const URL_ = process.env.SUPABASE_TEST_URL ?? '';
const PUBLISHABLE = process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? '';
const SECRET = process.env.SUPABASE_TEST_SECRET_KEY ?? '';

if (!URL_ || !PUBLISHABLE || !SECRET) {
  throw new Error('Run DB tests with `npm run test:db` (needs the local Supabase stack).');
}
const host = new URL(URL_).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  throw new Error(`Refusing to run DB tests against ${host}: local stack only.`);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const service: DB = createClient<Database>(URL_, SECRET, opts);
export const anon = (): DB => createClient<Database>(URL_, PUBLISHABLE, opts);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export interface TestUser {
  id: string;
  email: string;
  client: DB;
}

/** A signed-in user. role → also an admin; mfa → session upgraded to aal2. */
export async function makeUser(opts: { role?: 'owner' | 'organizer'; mfa?: boolean } = {}): Promise<TestUser> {
  const email = `test-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const { data: created, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw error ?? new Error('createUser failed');
  const id = created.user.id;

  if (opts.role) {
    const { error: e } = await service.from('admin_users').insert({ user_id: id, role: opts.role });
    if (e) throw e;
  }

  const client = anon();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  if (opts.mfa) {
    const { data: factor, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp' });
    if (enrollError || !factor) throw enrollError ?? new Error('enroll failed');
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    });
    if (verifyError) throw verifyError;
  }
  return { id, email, client };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
export function phone(): string {
  return `+2135${String(randomInt(0, 99_999_999)).padStart(8, '0')}`;
}

function dateFromToday(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function makeTrip(
  patch: Partial<Database['public']['Tables']['trips']['Insert']> = {},
): Promise<Database['public']['Tables']['trips']['Row']> {
  const slug = `test-trip-${randomUUID().slice(0, 8)}`;
  const { data, error } = await service
    .from('trips')
    .insert({
      slug,
      title_ar: 'خرجة تجريبية',
      title_en: 'Test trip',
      region: 'aures',
      terrain: ['mountain'],
      difficulty: 'easy',
      start_date: dateFromToday(20),
      end_date: dateFromToday(21),
      price_da: 2500,
      capacity: 5,
      hold_hours: 48,
      status: 'open',
      ...patch,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function reserveArgs(tripId: string, p = phone(), extra: Partial<Record<string, unknown>> = {}) {
  return {
    p_trip_id: tripId,
    p_full_name: 'Lina Benali',
    p_phone: p,
    p_wilaya_code: '05',
    p_age: 25,
    p_consent: true,
    ...extra,
  } as {
    p_trip_id: string;
    p_full_name: string;
    p_phone: string;
    p_wilaya_code: string;
    p_age: number;
    p_consent: boolean;
  };
}

export interface ReserveResult {
  code: string;
  status: 'pending' | 'waitlist' | 'confirmed';
  hold_expires_at: string | null;
  seats_left: number;
  existing: boolean;
}

export async function reserve(tripId: string, p = phone()): Promise<ReserveResult> {
  const { data, error } = await service.rpc('reserve_seat', reserveArgs(tripId, p));
  if (error) throw new Error(`reserve_seat failed: ${JSON.stringify(error)}`);
  return data as unknown as ReserveResult;
}

export async function reservationByCode(code: string) {
  const { data, error } = await service.from('reservations').select('*').eq('code', code).single();
  if (error) throw error;
  return data;
}

/** True when an API call was denied: an error, or (for RLS-filtered reads/writes) no rows. */
export function denied(result: { error: unknown; data: unknown }): boolean {
  if (result.error) return true;
  if (Array.isArray(result.data)) return result.data.length === 0;
  return result.data == null;
}
