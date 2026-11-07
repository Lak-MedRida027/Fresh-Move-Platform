/**
 * Excel export data (JSON). The admin page posts which list it wants with the
 * same filters as the page; this reads every matching row as the signed-in
 * admin (RLS applies), records the export in the audit log, then returns the
 * workbook description. The browser builds the .xlsx (src/lib/excel/workbook.ts):
 * Workers can't spend the CPU time.
 *
 * Request:  { kind: 'reservations' | 'members', lang: 'ar' | 'en', trip_id?, query: '<page query string>' }
 * Response: { ok: true, rows, spec } | { ok: false, error, max? }
 *
 * If the audit log write fails, nothing is returned.
 */
import type { APIRoute } from 'astro';
import {
  memberQuery,
  parseMemberFilter,
  parseReservationFilter,
  reservationQuery,
  seatCounts,
  type MemberRow,
  type ReservationWithPeople,
} from '../../../lib/admin/data';
import { notAllowed } from '../../../lib/admin/forms';
import { auditFilter, membersExport, reservationsExport } from '../../../lib/excel/exports';
import { MAX_EXPORT_ROWS } from '../../../lib/excel/spec';
import { UUID_RE } from '../../../lib/images/sizes';

export const prerender = false;

const BATCH = 1000; // PostgREST returns at most 1000 rows per request

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const jsonError = (error: string, status = 400, extra?: Record<string, unknown>) => json({ ok: false, error, ...extra }, status);

class TooMany extends Error {}

/** Reads every page of a query (stable order), refusing more than MAX_EXPORT_ROWS. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await page(from, from + BATCH - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (rows.length > MAX_EXPORT_ROWS) throw new TooMany();
    if (!data || data.length < BATCH) return rows;
  }
}

interface Body {
  kind?: unknown;
  lang?: unknown;
  trip_id?: unknown;
  query?: unknown;
}

export const POST: APIRoute = async (context) => {
  const admin = context.locals.admin;
  if (!admin) return jsonError('forbidden', 403);
  // JSON isn't covered by Astro's form CSRF check: require a same-origin request.
  if (context.request.headers.get('origin') !== context.url.origin) return jsonError('forbidden', 403);
  if (!(context.request.headers.get('content-type') ?? '').startsWith('application/json')) return jsonError('invalid_input', 415);
  let body: Body;
  try {
    body = (await context.request.json()) as Body;
  } catch {
    return jsonError('invalid_input');
  }
  const sb = admin.supabase;
  const locale = body.lang === 'en' ? 'en' : 'ar';
  const params = new URLSearchParams(typeof body.query === 'string' ? body.query.slice(0, 500) : '');

  try {
    if (body.kind === 'reservations') {
      const tripId = body.trip_id === undefined || body.trip_id === null || body.trip_id === '' ? null : body.trip_id;
      if (tripId !== null && (typeof tripId !== 'string' || !UUID_RE.test(tripId))) return jsonError('invalid_input');
      const { status, q } = parseReservationFilter(params);

      let trip: Parameters<typeof reservationsExport>[0]['trip'];
      if (tripId) {
        const [{ data: row }, { data: all }] = await Promise.all([
          sb.from('trips').select('slug, title_ar, title_en, start_date, end_date, price_da, capacity').eq('id', tripId).maybeSingle(),
          sb.from('reservations').select('status, hold_expires_at').eq('trip_id', tripId),
        ]);
        if (!row) return jsonError('not_found', 404);
        const list = all ?? [];
        trip = {
          row,
          counts: {
            ...seatCounts(row, list),
            cancelled: list.filter((r) => r.status === 'cancelled').length,
            expired: list.filter((r) => r.status === 'expired').length,
          },
        };
      }

      const make = await reservationQuery(sb, { tripId: tripId ?? undefined, status, q }, false);
      const rows = make
        ? await readAll<ReservationWithPeople>(
            (from, to) =>
              make()
                .order('created_at', { ascending: false })
                .order('id')
                .range(from, to) as unknown as PromiseLike<{ data: ReservationWithPeople[] | null; error: unknown }>,
          )
        : [];

      const { error } = await sb.rpc('log_export', {
        p_entity: 'reservations',
        p_entity_id: tripId ?? '',
        p_rows: rows.length,
        p_filter: auditFilter({ status, q }),
      });
      if (error) return jsonError('forbidden', 403);
      return json({ ok: true, rows: rows.length, spec: reservationsExport({ locale, rows, filter: { status, q }, trip }) });
    }

    if (body.kind === 'members') {
      const filter = parseMemberFilter(params);
      const rows = await readAll<MemberRow>((from, to) =>
        memberQuery(sb, filter, false).order('created_at', { ascending: false }).order('id').range(from, to),
      );
      const { error } = await sb.rpc('log_export', {
        p_entity: 'members',
        p_entity_id: '',
        p_rows: rows.length,
        p_filter: auditFilter({ q: filter.q, wilaya: filter.wilaya, age_min: filter.ageMin, age_max: filter.ageMax }),
      });
      if (error) return jsonError('forbidden', 403);
      return json({ ok: true, rows: rows.length, spec: membersExport({ locale, rows }) });
    }
  } catch (e) {
    if (e instanceof TooMany) return jsonError('too_many_rows', 413, { max: MAX_EXPORT_ROWS });
    console.error('export failed', e);
    return jsonError('generic', 500);
  }
  return jsonError('invalid_input');
};

export const ALL: APIRoute = () => notAllowed();
