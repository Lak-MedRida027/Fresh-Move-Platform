/**
 * Trip form ↔ database row. Pure functions (unit-tested): slug from the English
 * title, Algeria-time deadline conversion, and validation. The database checks
 * the same rules again (constraints + triggers).
 */
import type { Database } from '../database.types';
import { REGION_IDS, TERRAINS } from '../../data/regions';

type TripInsert = Database['public']['Tables']['trips']['Insert'];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const TRIP_STATUSES = ['draft', 'open', 'closed', 'completed', 'cancelled'] as const;

/** "Camping Tizeghben (Winter)" → "camping-tizeghben-winter". */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
}

/** "2026-11-20T18:00" typed in Algeria time → ISO with +01:00 (no DST in Algeria). */
export function algiersLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+01:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → "YYYY-MM-DDTHH:MM" in Algeria time, for <input type="datetime-local">. */
export function isoToAlgiersLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + 60 * 60 * 1000); // UTC+1
  return d.toISOString().slice(0, 16);
}

export type TripFormErrors = Partial<Record<string, string>>;

export interface ParsedTrip {
  values: TripInsert;
  errors: TripFormErrors;
}

const text = (form: FormData, k: string, max: number) => String(form.get(k) ?? '').trim().slice(0, max);
const int = (form: FormData, k: string) => {
  const v = String(form.get(k) ?? '').trim();
  return /^\d+$/.test(v) ? Number(v) : null;
};

export function parseTripForm(form: FormData): ParsedTrip {
  const errors: TripFormErrors = {};
  const title_ar = text(form, 'title_ar', 120);
  const title_en = text(form, 'title_en', 120);
  if (!title_ar) errors.title_ar = 'required';
  if (!title_en) errors.title_en = 'required';

  const slugInput = text(form, 'slug', 80);
  const slug = slugInput ? slugify(slugInput) : slugify(title_en);
  if (!slug) errors.slug = 'required';

  const region = text(form, 'region', 40);
  if (!(REGION_IDS as readonly string[]).includes(region)) errors.region = 'required';
  const terrain = form.getAll('terrain').map(String).filter((x) => (TERRAINS as readonly string[]).includes(x));
  if (!terrain.length) errors.terrain = 'required';

  const difficulty = text(form, 'difficulty', 10);
  const status = text(form, 'status', 12) || 'draft';
  if (!(TRIP_STATUSES as readonly string[]).includes(status)) errors.status = 'invalid';

  const start_date = text(form, 'start_date', 10) || null;
  const end_date = text(form, 'end_date', 10) || null;
  if (start_date && end_date && end_date < start_date) errors.end_date = 'dates_order';

  const price_da = int(form, 'price_da');
  const capacity = int(form, 'capacity');
  const hold_hours = int(form, 'hold_hours') ?? 48;
  if (hold_hours < 1 || hold_hours > 336) errors.hold_hours = 'invalid';
  if (capacity !== null && capacity > 1000) errors.capacity = 'invalid';

  const deadlineRaw = text(form, 'registration_deadline', 20);
  const registration_deadline = deadlineRaw ? algiersLocalToIso(deadlineRaw) : null;
  if (deadlineRaw && !registration_deadline) errors.registration_deadline = 'invalid';

  const meeting_time = text(form, 'meeting_time', 5) || null;
  if (meeting_time && !/^\d{2}:\d{2}$/.test(meeting_time)) errors.meeting_time = 'invalid';
  const instagram_post_url = text(form, 'instagram_post_url', 300) || null;
  if (instagram_post_url && !/^https:\/\/(www\.)?instagram\.com\//.test(instagram_post_url)) errors.instagram_post_url = 'invalid';

  // Bookable trips need the essentials (the database enforces this too).
  if ((status === 'open' || status === 'closed') && (!start_date || !end_date || !difficulty || price_da === null || capacity === null)) {
    errors.status = 'bookable_incomplete';
  }

  const values: TripInsert = {
    slug,
    title_ar,
    title_en,
    summary_ar: text(form, 'summary_ar', 500),
    summary_en: text(form, 'summary_en', 500),
    description_ar: text(form, 'description_ar', 8000),
    description_en: text(form, 'description_en', 8000),
    region,
    terrain,
    difficulty: (DIFFICULTIES as readonly string[]).includes(difficulty) ? difficulty : null,
    start_date,
    end_date,
    meeting_point_ar: text(form, 'meeting_point_ar', 300) || null,
    meeting_point_en: text(form, 'meeting_point_en', 300) || null,
    meeting_time,
    price_da,
    capacity,
    hold_hours,
    registration_deadline,
    payment_instructions_ar: text(form, 'payment_instructions_ar', 4000),
    payment_instructions_en: text(form, 'payment_instructions_en', 4000),
    what_to_bring_ar: text(form, 'what_to_bring_ar', 4000),
    what_to_bring_en: text(form, 'what_to_bring_en', 4000),
    status,
    instagram_post_url,
    featured: form.get('featured') === '1',
  };
  return { values, errors };
}
