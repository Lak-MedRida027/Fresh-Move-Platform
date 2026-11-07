/**
 * e2e fixtures: three upcoming trips in the LOCAL database (open, full,
 * closed), created with the local stack's secret key from .env / .dev.vars.
 * Refuses to run against anything but localhost.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import type { Database } from '../../src/lib/database.types';

function readVars(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

export const E2E = {
  open: 'e2e-open-trip',
  full: 'e2e-full-trip',
  closed: 'e2e-closed-trip',
} as const;

export function localDb() {
  const env = { ...readVars('.env'), ...readVars('.dev.vars') };
  const url = env.PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const host = url ? new URL(url).hostname : '';
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`e2e fixtures: refusing non-local Supabase (${host})`);
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export async function setupFixtures(): Promise<void> {
  const db = localDb();
  // Clean previous runs (reservations first: trips are ON DELETE RESTRICT).
  const { data: old } = await db.from('trips').select('id').like('slug', 'e2e-%');
  const ids = (old ?? []).map((t) => t.id);
  if (ids.length) {
    await db.from('reservations').delete().in('trip_id', ids);
    await db.from('trips').update({ cover_image_id: null }).in('id', ids);
    await db.from('trip_images').delete().in('trip_id', ids);
    await db.from('trips').delete().in('id', ids);
  }
  await db.from('members').delete().like('full_name', 'Zz %');
  // Fresh rate-limit counters so repeated local runs don't trip the per-phone / per-code limits.
  await db.from('rate_limits').delete().gte('hits', 0);

  const poster = await sharp({
    create: { width: 1080, height: 1350, channels: 3, background: { r: 58, g: 90, b: 58 } },
  })
    .webp({ quality: 70 })
    .toBuffer();

  const base = {
    region: 'aures',
    terrain: ['mountain'],
    difficulty: 'medium',
    start_date: day(25),
    end_date: day(26),
    price_da: 3500,
    hold_hours: 48,
    meeting_point_ar: 'محطة باتنة',
    meeting_point_en: 'Batna bus station',
    meeting_time: '06:30',
    summary_ar: 'خرجة تجريبية للاختبارات.',
    summary_en: 'A test trip for automated tests.',
    description_ar: 'وصف الخرجة.',
    description_en: 'Trip description.',
    what_to_bring_ar: 'ماء وسبّاط مريح.',
    what_to_bring_en: 'Water and good shoes.',
    payment_instructions_ar: 'BaridiMob: 00799999000000000000\nقبل آخر أجل.',
    payment_instructions_en: 'BaridiMob: 00799999000000000000\nBefore the deadline.',
  } as const;

  const trips = [
    { slug: E2E.open, title_ar: 'خرجة مفتوحة', title_en: 'E2E Open Trip', capacity: 30, status: 'open', registration_deadline: new Date(Date.now() + 10 * 86_400_000).toISOString() },
    { slug: E2E.full, title_ar: 'خرجة كاملة', title_en: 'E2E Full Trip', capacity: 1, status: 'open', registration_deadline: null },
    { slug: E2E.closed, title_ar: 'خرجة مسكّرة', title_en: 'E2E Closed Trip', capacity: 10, status: 'closed', registration_deadline: null },
  ] as const;

  for (const t of trips) {
    const { data: trip, error } = await db.from('trips').insert({ ...base, ...t, terrain: [...base.terrain] }).select('id').single();
    if (error) throw error;
    const imageId = crypto.randomUUID();
    for (const size of ['sm', 'md', 'lg']) {
      const { error: up } = await db.storage
        .from('trip-images')
        .upload(`trips/${trip.id}/${imageId}-${size}.webp`, poster, { contentType: 'image/webp', upsert: true });
      if (up) throw up;
    }
    await db.from('trip_images').insert({
      id: imageId,
      trip_id: trip.id,
      kind: 'poster',
      path_sm: `trips/${trip.id}/${imageId}-sm.webp`,
      path_md: `trips/${trip.id}/${imageId}-md.webp`,
      path_lg: `trips/${trip.id}/${imageId}-lg.webp`,
      width: 1080,
      height: 1350,
      alt_ar: `${t.title_ar}، بوستر`,
      alt_en: `${t.title_en} poster`,
    });
    await db.from('trips').update({ cover_image_id: imageId }).eq('id', trip.id);
  }

  // Fill the "full" trip's only seat.
  const { data: full } = await db.from('trips').select('id').eq('slug', E2E.full).single();
  const { data: m, error: memberError } = await db
    .from('members')
    .upsert({ full_name: 'Zz Seat Holder', phone: '+213799999901', wilaya_code: '05', age: 30 }, { onConflict: 'phone' })
    .select('id')
    .single();
  if (memberError) throw memberError;
  await db.from('reservations').insert({ code: 'FM-E2EAA', trip_id: full!.id, member_id: m!.id, status: 'confirmed' });
}

export default setupFixtures;
