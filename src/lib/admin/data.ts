/**
 * Admin data loading. Every query runs as the signed-in admin (RLS + MFA
 * enforced by the database); nothing here uses the secret key.
 */
import type { Database } from '../database.types';
import { todayInAlgeria } from '../dates';
import type { AdminClient } from '../supabase/server';

export type TripRow = Database['public']['Tables']['trips']['Row'];
export type ReservationRow = Database['public']['Tables']['reservations']['Row'];
export type MemberRow = Database['public']['Tables']['members']['Row'];
export type JobRunRow = Database['public']['Tables']['job_runs']['Row'];

/** How late a job may be before the overview warns: 15-min job → 1 h, daily → 36 h. */
export const JOB_MAX_AGE_MS = { frequent: 3_600_000, daily: 36 * 3_600_000 } as const;

export interface JobHealth {
  job: 'frequent' | 'daily';
  /** never: hasn't run yet (normal before the first deploy); ok; late; failed. */
  state: 'never' | 'ok' | 'late' | 'failed';
  last: string | null;
}

export function jobHealth(rows: Pick<JobRunRow, 'job' | 'started_at' | 'finished_at' | 'ok'>[], now = Date.now()): JobHealth[] {
  return (['frequent', 'daily'] as const).map((job) => {
    const r = rows.find((x) => x.job === job);
    if (!r) return { job, state: 'never', last: null };
    const last = r.finished_at ?? r.started_at;
    if (r.ok === false) return { job, state: 'failed', last };
    // Not run recently, or started an hour ago and never finished (crashed mid-run): late.
    const age = now - Date.parse(last);
    return { job, state: age > JOB_MAX_AGE_MS[job] || (!r.finished_at && age > 3_600_000) ? 'late' : 'ok', last };
  });
}

export interface SeatCounts {
  confirmed: number;
  pending: number; // unexpired holds
  waitlist: number;
  left: number;
}

export function seatCounts(trip: Pick<TripRow, 'capacity'>, rows: Pick<ReservationRow, 'status' | 'hold_expires_at'>[], now = Date.now()): SeatCounts {
  const confirmed = rows.filter((r) => r.status === 'confirmed').length;
  const pending = rows.filter((r) => r.status === 'pending' && r.hold_expires_at && Date.parse(r.hold_expires_at) > now).length;
  const waitlist = rows.filter((r) => r.status === 'waitlist').length;
  return { confirmed, pending, waitlist, left: Math.max((trip.capacity ?? 0) - confirmed - pending, 0) };
}

export type ReservationWithPeople = ReservationRow & {
  member: Pick<MemberRow, 'id' | 'full_name' | 'phone' | 'wilaya_code' | 'age'> | null;
  trip: Pick<TripRow, 'id' | 'slug' | 'title_ar' | 'title_en'> | null;
};

const RES_SELECT =
  '*, member:members(id, full_name, phone, wilaya_code, age), trip:trips(id, slug, title_ar, title_en)';

export async function loadOverview(sb: AdminClient) {
  const today = todayInAlgeria();
  const now = Date.now();
  const { data: trips } = await sb
    .from('trips')
    .select('*')
    .in('status', ['open', 'closed', 'draft'])
    .gte('start_date', today)
    .order('start_date');
  const ids = (trips ?? []).map((t) => t.id);
  const { data: res } = ids.length
    ? await sb.from('reservations').select('trip_id, status, hold_expires_at').in('trip_id', ids)
    : { data: [] as Pick<ReservationRow, 'trip_id' | 'status' | 'hold_expires_at'>[] };
  const upcoming = (trips ?? []).map((t) => ({ trip: t, counts: seatCounts(t, (res ?? []).filter((r) => r.trip_id === t.id), now) }));

  const in12h = new Date(now + 12 * 3_600_000).toISOString();
  const [{ count: pending }, { count: waitlist }, { data: expiring }, { data: latest }, { data: storage }, { data: jobs }] = await Promise.all([
    sb.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'pending').gt('hold_expires_at', new Date(now).toISOString()),
    sb.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'waitlist'),
    sb
      .from('reservations')
      .select(RES_SELECT)
      .eq('status', 'pending')
      .gt('hold_expires_at', new Date(now).toISOString())
      .lte('hold_expires_at', in12h)
      .order('hold_expires_at')
      .limit(20),
    sb.from('reservations').select(RES_SELECT).order('created_at', { ascending: false }).limit(10),
    sb.rpc('admin_storage_usage'),
    sb.from('job_runs').select('job, started_at, finished_at, ok'),
  ]);
  return {
    upcoming,
    pending: pending ?? 0,
    waitlist: waitlist ?? 0,
    expiring: (expiring ?? []) as unknown as ReservationWithPeople[],
    latest: (latest ?? []) as unknown as ReservationWithPeople[],
    jobs: jobHealth(jobs ?? [], now),
    storage: (storage ?? { bytes: 0, objects: 0, quota_bytes: 1073741824 }) as { bytes: number; objects: number; quota_bytes: number },
  };
}

export const RES_STATUSES = ['pending', 'confirmed', 'waitlist', 'cancelled', 'expired'] as const;

export interface ReservationFilter {
  tripId?: string;
  status?: string;
  q?: string;
  page?: number;
}
export const PAGE_SIZE = 50;

/** Filters from the reservations page URL (also sent by the export button). */
export function parseReservationFilter(params: URLSearchParams): { status: string; q: string; page: number } {
  const s = params.get('status') ?? '';
  return {
    status: (RES_STATUSES as readonly string[]).includes(s) ? s : '',
    q: (params.get('q') ?? '').slice(0, 60),
    page: Math.max(1, Number(params.get('page') ?? '1') || 1),
  };
}

/**
 * Query builder for the reservations list and its export. The search (name,
 * phone or code) is resolved once; the returned function makes a fresh query
 * each call, so the export can read every page. Null: nothing can match.
 */
export async function reservationQuery(sb: AdminClient, f: ReservationFilter, withCount: boolean) {
  const q = (f.q ?? '').trim();
  let code: string | null = null;
  let memberIds: string[] | null = null;
  if (q) {
    const c = q.toUpperCase().replace(/\s/g, '');
    if (/^FM-?[2-9A-HJ-NP-Z]{1,5}$/.test(c)) {
      code = c.replace(/^FM-?/, '');
    } else {
      // Members matching the name or phone, then their reservations.
      const digits = q.replace(/\D/g, '');
      const phoneLike = digits.length >= 4 ? `%${digits.replace(/^0/, '')}%` : null;
      const safe = q.replace(/[%_,()]/g, ' ');
      const { data: members } = await sb
        .from('members')
        .select('id')
        .or([`full_name.ilike.%${safe}%`, phoneLike ? `phone.ilike.${phoneLike}` : ''].filter(Boolean).join(','))
        .limit(500);
      memberIds = (members ?? []).map((m) => m.id);
      if (!memberIds.length) return null;
    }
  }
  return () => {
    let query = sb.from('reservations').select(RES_SELECT, withCount ? { count: 'exact' } : undefined);
    if (f.tripId) query = query.eq('trip_id', f.tripId);
    if (f.status) query = query.eq('status', f.status);
    if (code) query = query.ilike('code', `%${code}%`);
    if (memberIds) query = query.in('member_id', memberIds);
    return query;
  };
}

/** Reservations list with search (name, phone, code) and status filter. */
export async function loadReservations(sb: AdminClient, f: ReservationFilter) {
  const make = await reservationQuery(sb, f, true);
  if (!make) return { rows: [] as ReservationWithPeople[], total: 0 };
  const page = Math.max(1, f.page ?? 1);
  const { data, count } = await make()
    .order('created_at', { ascending: !!f.tripId })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  return { rows: (data ?? []) as unknown as ReservationWithPeople[], total: count ?? 0 };
}

export interface MemberFilter {
  q: string;
  wilaya: string;
  ageMin: number | null;
  ageMax: number | null;
  page: number;
}

/** Filters from the members page URL (also sent by the export button). */
export function parseMemberFilter(p: URLSearchParams): MemberFilter {
  const age = (v: string | null) => {
    const n = Number(v ?? '');
    return Number.isInteger(n) && n > 0 && n <= 150 ? n : null;
  };
  return {
    q: (p.get('q') ?? '').slice(0, 60),
    wilaya: /^\d{2}$/.test(p.get('wilaya') ?? '') ? p.get('wilaya')! : '',
    ageMin: age(p.get('age_min')),
    ageMax: age(p.get('age_max')),
    page: Math.max(1, Number(p.get('page') ?? '1') || 1),
  };
}

/** Query for the members list and its export (a fresh builder each call). */
export function memberQuery(sb: AdminClient, f: MemberFilter, withCount: boolean) {
  let query = sb.from('members').select('*', withCount ? { count: 'exact' } : undefined);
  const q = f.q.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const safe = q.replace(/[%_,()]/g, ' ');
    const ors = [`full_name.ilike.%${safe}%`];
    if (digits.length >= 4) ors.push(`phone.ilike.%${digits.replace(/^0/, '')}%`);
    query = query.or(ors.join(','));
  }
  if (f.wilaya) query = query.eq('wilaya_code', f.wilaya);
  if (f.ageMin) query = query.gte('age', f.ageMin);
  if (f.ageMax) query = query.lte('age', f.ageMax);
  return query;
}

export function whatsappLink(phone: string | null | undefined): string | null {
  return phone ? `https://wa.me/${phone.replace(/^\+/, '')}` : null;
}

export function formatBytes(bytes: number, locale: 'ar' | 'en'): string {
  const fmt = new Intl.NumberFormat(locale === 'ar' ? 'ar-DZ' : 'en', { maximumFractionDigits: 1 });
  const text =
    bytes >= 1024 ** 3
      ? `${fmt.format(bytes / 1024 ** 3)} GB`
      : bytes >= 1024 ** 2
        ? `${fmt.format(bytes / 1024 ** 2)} MB`
        : `${fmt.format(bytes / 1024)} KB`;
  // In Darja the Latin unit would be reordered by the bidi algorithm
  // ("GB 1" instead of "1 GB"); a left-to-right isolate keeps "1,2 MB" intact.
  return locale === 'ar' ? `\u2066${text}\u2069` : text;
}
