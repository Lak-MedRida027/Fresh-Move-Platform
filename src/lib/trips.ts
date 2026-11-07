/**
 * Trips from Supabase, shaped for the pages. Reads use the publishable key
 * (RLS: only open / closed / completed trips are visible).
 */
import type { Locale } from '../i18n';
import { t } from '../i18n';
import type { RegionId, Terrain } from '../data/regions';
import type { Database } from './database.types';
import { memo } from './memo';
import { srcset, storageUrl } from './media';
import { supabasePublic, type PublicClient } from './supabase/public';

type TripRow = Database['public']['Tables']['trips']['Row'];
type ImageRow = Database['public']['Tables']['trip_images']['Row'];

export interface TripImage {
  id: string;
  kind: 'poster' | 'gallery';
  width: number;
  height: number;
  src: string; // md
  srcLg: string;
  srcset: string;
  placeholder: string | null;
  alt: { ar: string; en: string };
}

export interface Trip {
  id: string;
  slug: string;
  title: { ar: string; en: string };
  summary: { ar: string; en: string };
  description: { ar: string; en: string };
  region: RegionId;
  terrain: Terrain[];
  difficulty: 'easy' | 'medium' | 'hard' | null;
  startDate: string | null;
  endDate: string | null;
  status: 'open' | 'closed' | 'completed' | 'draft' | 'cancelled';
  featured: boolean;
  instagramPostUrl: string | null;
  priceDa: number | null;
  capacity: number | null;
  holdHours: number;
  registrationDeadline: string | null;
  meetingPoint: { ar: string; en: string };
  meetingTime: string | null;
  paymentInstructions: { ar: string; en: string };
  whatToBring: { ar: string; en: string };
  cover: TripImage | null;
  gallery: TripImage[];
}

const CACHE_MS = 60_000;

export function toImage(row: ImageRow, base?: string): TripImage {
  return {
    id: row.id,
    kind: row.kind as TripImage['kind'],
    width: row.width,
    height: row.height,
    src: storageUrl(row.path_md, base),
    srcLg: storageUrl(row.path_lg, base),
    srcset: srcset(row, base),
    placeholder: row.placeholder,
    alt: { ar: row.alt_ar, en: row.alt_en },
  };
}

export function toTrip(row: TripRow & { images?: ImageRow[] | null }, base?: string): Trip {
  const images = [...(row.images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const coverRow =
    images.find((i) => i.id === row.cover_image_id) ?? images.find((i) => i.kind === 'poster') ?? images[0] ?? null;
  return {
    id: row.id,
    slug: row.slug,
    title: { ar: row.title_ar, en: row.title_en },
    summary: { ar: row.summary_ar, en: row.summary_en },
    description: { ar: row.description_ar, en: row.description_en },
    region: row.region as RegionId,
    terrain: row.terrain as Terrain[],
    difficulty: row.difficulty as Trip['difficulty'],
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as Trip['status'],
    featured: row.featured,
    instagramPostUrl: row.instagram_post_url,
    priceDa: row.price_da,
    capacity: row.capacity,
    holdHours: row.hold_hours,
    registrationDeadline: row.registration_deadline,
    meetingPoint: { ar: row.meeting_point_ar ?? '', en: row.meeting_point_en ?? '' },
    meetingTime: row.meeting_time,
    paymentInstructions: { ar: row.payment_instructions_ar, en: row.payment_instructions_en },
    whatToBring: { ar: row.what_to_bring_ar, en: row.what_to_bring_en },
    cover: coverRow ? toImage(coverRow, base) : null,
    gallery: images.filter((i) => i.kind === 'gallery').map((i) => toImage(i, base)),
  };
}

// Two foreign keys link trips and trip_images (trip_id and cover_image_id), so
// the embed names the one to follow.
const SELECT = '*, images:trip_images!trip_images_trip_id_fkey(*)';

/** Newest first; trips without a date go last, then by English title. */
export function sortTrips(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    const da = a.startDate ?? '';
    const db = b.startDate ?? '';
    if (da !== db) return db.localeCompare(da);
    return a.title.en.localeCompare(b.title.en);
  });
}

export async function fetchTrips(client: PublicClient = supabasePublic()): Promise<Trip[]> {
  const { data, error } = await client.from('trips').select(SELECT);
  if (error) throw error;
  return data.map((row) => toTrip(row as TripRow & { images: ImageRow[] }));
}

/** All published trips (cached per isolate for a minute). */
export function getTrips(): Promise<Trip[]> {
  return memo('trips:all', CACHE_MS, fetchTrips);
}

/** Past trips for the gallery: status `completed`. */
export async function getPastTrips(): Promise<Trip[]> {
  return sortTrips((await getTrips()).filter((t) => t.status === 'completed'));
}

export async function getFeaturedTrips(limit = 6): Promise<Trip[]> {
  const past = await getPastTrips();
  return [...past.filter((t) => t.featured), ...past.filter((t) => !t.featured)].slice(0, limit);
}

export async function getTripBySlug(slug: string): Promise<Trip | null> {
  return (await getTrips()).find((t) => t.slug === slug) ?? null;
}

/** "November 2025" / "نوفمبر 2025", or the "to be confirmed" label. */
export function formatTripDate(date: string | null, locale: Locale): string {
  if (!date) return t(locale, 'date.tbd');
  const [year, month] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, 1));
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}
