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
  const [{ count: pending }, { count: waitlist }, { data: expiring }, { data: latest }, { data: storage }] = await Promise.all([
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
  ]);
  return {
    upcoming,
    pending: pending ?? 0,
    waitlist: waitlist ?? 0,
    expiring: (expiring ?? []) as unknown as ReservationWithPeople[],
    latest: (latest ?? []) as unknown as ReservationWithPeople[],
    storage: (storage ?? { bytes: 0, objects: 0, quota_bytes: 1073741824 }) as { bytes: number; objects: number; quota_bytes: number },
  };
}

export interface ReservationFilter {
  tripId?: string;
  status?: string;
  q?: string;
  page?: number;
}
export const PAGE_SIZE = 50;

/** Reservations list with search (name, phone, code) and status filter. */
export async function loadReservations(sb: AdminClient, f: ReservationFilter) {
  let query = sb.from('reservations').select(RES_SELECT, { count: 'exact' });
  if (f.tripId) query = query.eq('trip_id', f.tripId);
  if (f.status) query = query.eq('status', f.status);
  const q = (f.q ?? '').trim();
  if (q) {
    const code = q.toUpperCase().replace(/\s/g, '');
    if (/^FM-?[2-9A-HJ-NP-Z]{1,5}$/.test(code)) {
      query = query.ilike('code', `%${code.replace(/^FM-?/, '')}%`);
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
      const ids = (members ?? []).map((m) => m.id);
      if (!ids.length) return { rows: [] as ReservationWithPeople[], total: 0 };
      query = query.in('member_id', ids);
    }
  }
  const page = Math.max(1, f.page ?? 1);
  const { data, count } = await query
    .order(f.tripId ? 'created_at' : 'created_at', { ascending: !!f.tripId })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  return { rows: (data ?? []) as unknown as ReservationWithPeople[], total: count ?? 0 };
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
