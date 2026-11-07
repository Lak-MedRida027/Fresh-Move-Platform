/**
 * What goes into each export: sheet names, columns and rows, in the admin's
 * language. Runs on the server (the export endpoint) and in the tests; the
 * browser turns the result into the .xlsx file (workbook.ts).
 */
import { getWilaya, wilayaLabel } from '../../data/wilayas';
import { adminT, type AdminKey } from '../../i18n/admin';
import type { Locale } from '../../i18n';
import { todayInAlgeria } from '../dates';
import type { MemberRow, ReservationWithPeople, SeatCounts, TripRow } from '../admin/data';
import { fileName, type Cell, type Column, type ExportSpec, type PairsSheet } from './spec';

const STATUS_ORDER = ['confirmed', 'pending', 'waitlist', 'cancelled', 'expired'];

function wilayaText(code: string | null | undefined, locale: Locale): string | null {
  if (!code) return null;
  const w = getWilaya(code);
  return w ? `${code} - ${wilayaLabel(w, locale)}` : code;
}

/** "Status: Confirmed · Search: ali", or "None (everything)". */
function describeFilter(locale: Locale, parts: [AdminKey, string | number | null | undefined][]): string {
  const t = adminT(locale);
  const used = parts.filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${t(k)}: ${v}`);
  return used.length ? used.join(' · ') : t('exp.noFilter');
}

export interface ReservationExportInput {
  locale: Locale;
  rows: ReservationWithPeople[];
  filter: { status: string; q: string };
  /** Per-trip export: the trip and its seat counts (all reservations, not just the filtered ones). */
  trip?: { row: Pick<TripRow, 'slug' | 'title_ar' | 'title_en' | 'start_date' | 'end_date' | 'price_da' | 'capacity'>; counts: SeatCounts & { cancelled: number; expired: number } };
  now?: Date;
}

export function reservationsExport({ locale, rows, filter, trip, now = new Date() }: ReservationExportInput): ExportSpec {
  const t = adminT(locale);
  const title = (r: { title_ar: string; title_en: string } | null | undefined) => (r ? (locale === 'ar' ? r.title_ar : r.title_en) : null);

  const columns: Column[] = [
    { header: t('res.code'), width: 11, type: 'text' },
    ...(trip ? [] : [{ header: t('res.trip'), width: 28, type: 'text' } as Column]),
    { header: t('res.status'), width: 18, type: 'text' },
    { header: t('res.name'), width: 26, type: 'text' },
    { header: t('res.phone'), width: 16, type: 'phone' },
    { header: t('res.wilaya'), width: 20, type: 'text' },
    { header: t('res.age'), width: 7, type: 'number' },
    { header: t('res.created'), width: 17, type: 'datetime' },
    { header: t('res.hold'), width: 17, type: 'datetime' },
    { header: t('exp.confirmedAt'), width: 17, type: 'datetime' },
    { header: t('res.method'), width: 14, type: 'text' },
    { header: t('res.amount'), width: 12, type: 'money' },
    { header: t('exp.via'), width: 14, type: 'text' },
    { header: t('exp.waitlistedAt'), width: 17, type: 'datetime' },
    { header: t('exp.cancelledAt'), width: 17, type: 'datetime' },
    { header: t('exp.cancelReason'), width: 30, type: 'text', wrap: true },
    { header: t('res.note'), width: 40, type: 'text', wrap: true },
  ];

  // Per trip: the list you'd print for the bus (confirmed first, then holds,
  // then the waitlist in its order). Global: newest first, like the page.
  const sorted = trip
    ? [...rows].sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
          (a.waitlisted_at ?? a.created_at).localeCompare(b.waitlisted_at ?? b.created_at),
      )
    : rows;

  const body: Cell[][] = sorted.map((r) => [
    r.code,
    ...(trip ? [] : [title(r.trip)]),
    t(`rs.${r.status}` as AdminKey),
    r.member?.full_name ?? t('res.anonymised'),
    r.member?.phone ?? null,
    wilayaText(r.member?.wilaya_code, locale),
    r.member?.age ?? null,
    r.created_at,
    r.status === 'pending' ? r.hold_expires_at : null,
    r.confirmed_at,
    r.payment_method ? t(`method.${r.payment_method}` as AdminKey) : null,
    r.amount_paid_da,
    t(r.source === 'admin' ? 'exp.via.admin' : 'exp.via.web'),
    r.status === 'waitlist' ? r.waitlisted_at : null,
    r.cancelled_at,
    r.cancel_reason,
    r.admin_note,
  ]);

  const filterText = describeFilter(locale, [
    ['res.status', filter.status ? t(`rs.${filter.status}` as AdminKey) : ''],
    ['search', filter.q.trim()],
  ]);

  const sheets: ExportSpec['sheets'] = [];
  if (trip) {
    const c = trip.counts;
    const summary: PairsSheet = {
      kind: 'pairs',
      name: t('exp.sheet.summary'),
      headers: [t('exp.item'), t('exp.value')],
      pairs: [
        { label: t('res.trip'), value: title(trip.row), type: 'text' },
        { label: t('exp.start'), value: trip.row.start_date, type: 'date' },
        { label: t('exp.end'), value: trip.row.end_date, type: 'date' },
        { label: t('exp.price'), value: trip.row.price_da, type: 'money' },
        { label: t('seats.capacity'), value: trip.row.capacity, type: 'number' },
        { label: t('rs.confirmed'), value: c.confirmed, type: 'number' },
        { label: t('rs.pending'), value: c.pending, type: 'number' },
        { label: t('rs.waitlist'), value: c.waitlist, type: 'number' },
        { label: t('seats.left'), value: c.left, type: 'number' },
        { label: t('rs.cancelled'), value: c.cancelled, type: 'number' },
        { label: t('rs.expired'), value: c.expired, type: 'number' },
        { label: t('exp.filters'), value: filterText, type: 'text' },
        { label: t('exp.rows'), value: body.length, type: 'number' },
        { label: t('exp.exportedAt'), value: now.toISOString(), type: 'datetime' },
      ],
    };
    sheets.push(summary);
  }
  sheets.push({ kind: 'table', name: t('exp.sheet.reservations'), columns, rows: body });

  const day = todayInAlgeria(now);
  return {
    filename: trip ? fileName('fresh-move-reservations', trip.row.slug, day) : fileName('fresh-move-reservations', day),
    title: trip ? `${t('exp.sheet.reservations')}: ${title(trip.row)}` : t('exp.sheet.reservations'),
    rtl: locale === 'ar',
    sheets,
  };
}

export interface MemberExportInput {
  locale: Locale;
  rows: MemberRow[];
  now?: Date;
}

export function membersExport({ locale, rows, now = new Date() }: MemberExportInput): ExportSpec {
  const t = adminT(locale);
  const columns: Column[] = [
    { header: t('res.name'), width: 26, type: 'text' },
    { header: t('res.phone'), width: 16, type: 'phone' },
    { header: t('res.wilaya'), width: 20, type: 'text' },
    { header: t('res.age'), width: 7, type: 'number' },
    { header: t('mem.source'), width: 18, type: 'text' },
    { header: t('mem.joined'), width: 17, type: 'datetime' },
    { header: t('mem.consent'), width: 17, type: 'datetime' },
    { header: t('mem.notes'), width: 40, type: 'text', wrap: true },
  ];
  const body: Cell[][] = rows.map((m) => [
    m.full_name,
    m.phone,
    wilayaText(m.wilaya_code, locale),
    m.age,
    t(`src.${m.source}` as AdminKey),
    m.created_at,
    m.consent_at,
    m.notes,
  ]);
  return {
    filename: fileName('fresh-move-members', todayInAlgeria(now)),
    title: t('exp.sheet.members'),
    rtl: locale === 'ar',
    sheets: [{ kind: 'table', name: t('exp.sheet.members'), columns, rows: body }],
  };
}

/** The filters as stored in the audit log (no labels, just what was asked). */
export function auditFilter(f: Record<string, string | number | null | undefined>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(f)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 100) : (v as number)]),
  );
}
