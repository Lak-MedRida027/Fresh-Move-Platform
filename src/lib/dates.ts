/**
 * Dates and times for trips and reservations, always in Algeria time
 * (Africa/Algiers, UTC+1, no daylight saving).
 */
import type { Locale } from '../i18n';

export const TZ = 'Africa/Algiers';
const intlLocale = (locale: Locale) => (locale === 'ar' ? 'ar-DZ' : 'en-GB');

function utcDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1, 12));
}

/** "14 Nov 2026", "14–16 Nov 2026", "30 Nov – 2 Dec 2026" (dates are calendar days). */
export function formatDateRange(start: string, end: string | null, locale: Locale): string {
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const a = utcDate(start);
  if (!end || end === start) return fmt.format(a);
  return fmt.formatRange(a, utcDate(end));
}

/** "Fri 14 Nov, 18:00" in Algeria time. */
export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  }).format(new Date(iso));
}

/** "18:00" from a Postgres time ("18:00:00"). */
export function formatTime(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

/** Today's date in Algeria as YYYY-MM-DD. */
export function todayInAlgeria(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole days and hours left until `iso` (0 when past). */
export function timeLeft(iso: string, now = Date.now()): { days: number; hours: number; minutes: number; past: boolean } {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, past: true };
  const minutes = Math.floor(ms / 60_000);
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60, past: false };
}
