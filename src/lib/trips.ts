import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from '../i18n';
import { t } from '../i18n';

export type Trip = CollectionEntry<'trips'>;

/** Newest first; trips without a confirmed date ('TBD') go last, then by name. */
export function sortTrips(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    const da = a.data.date === 'TBD' ? '' : a.data.date;
    const db = b.data.date === 'TBD' ? '' : b.data.date;
    if (da !== db) return db.localeCompare(da);
    return a.data.title.en.localeCompare(b.data.title.en);
  });
}

export async function getTrips(): Promise<Trip[]> {
  return sortTrips(await getCollection('trips'));
}

export async function getFeaturedTrips(limit = 6): Promise<Trip[]> {
  const all = await getTrips();
  return [...all.filter((t) => t.data.featured), ...all.filter((t) => !t.data.featured)].slice(0, limit);
}

/** "November 2025" / "نوفمبر 2025", or the "to be confirmed" label. */
export function formatTripDate(date: string, locale: Locale): string {
  if (date === 'TBD') return t(locale, 'date.tbd');
  const [year, month] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, 1));
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}
