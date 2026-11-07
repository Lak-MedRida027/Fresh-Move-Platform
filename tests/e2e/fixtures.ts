/**
 * e2e fixtures: three upcoming trips in the LOCAL database (open, full,
 * closed), created with the local stack's secret key from .env / .dev.vars.
 * Refuses to run against anything but localhost.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { totp } from '../totp';
import sharp from 'sharp';
import type { Database } from '../../src/lib/database.types';

export function readVars(file: string): Record<string, string> {
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

/** Local e2e admin accounts (rebuilt every run). Credentials go to .playwright/ (gitignored). */
export const ADMIN_FILE = '.playwright/e2e-admins.json';
export interface E2EAdmin {
  email: string;
  password: string;
  totpSecret: string | null;
}
/** Browser projects (playwright.config.ts). Each gets its own admins: a TOTP code works only once. */
export const PROJECTS = ['mobile-chrome', 'mobile-safari', 'desktop-chrome'] as const;

export function readAdmins(project: string): Record<'owner' | 'organizer' | 'fresh', E2EAdmin> {
  const all = JSON.parse(readFileSync(ADMIN_FILE, 'utf8'));
  return { ...all[project], fresh: all.fresh };
}

async function setupAdmins(db: ReturnType<typeof localDb>): Promise<void> {
  const env = { ...readVars('.env') };
  type Account = [key: string, email: string, role: 'owner' | 'organizer', mfa: boolean];
  // Fresh addresses each run: the new accounts are created before the old ones
  // are deleted, because the database refuses to delete the last owner.
  const run = Date.now().toString(36);
  const accounts: Account[] = [
    ...PROJECTS.flatMap((p): Account[] => [
      [`${p}.owner`, `e2e-owner-${p}-${run}@example.test`, 'owner', true],
      [`${p}.organizer`, `e2e-organizer-${p}-${run}@example.test`, 'organizer', true],
    ]),
    ['fresh', `e2e-fresh-${run}@example.test`, 'organizer', false],
  ];
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const previous = (list?.users ?? []).filter((u) => u.email?.startsWith('e2e-') && u.email.endsWith('@example.test'));
  const out: Record<string, Record<string, E2EAdmin> | E2EAdmin> = {};
  for (const [key, email, role, mfa] of accounts) {
    const name = key;
    const password = `E2e-${randomUUID()}`;
    const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error('createUser failed');
    await db.from('admin_users').insert({ user_id: created.user.id, role, display_name: `E2E ${name}` });
    let totpSecret: string | null = null;
    if (mfa) {
      // Enrol a TOTP factor the way the app does, and keep the secret for the tests.
      const client = createClient<Database>(env.PUBLIC_SUPABASE_URL!, env.PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      await client.auth.signInWithPassword({ email, password });
      const { data: factor, error: e1 } = await client.auth.mfa.enroll({ factorType: 'totp' });
      if (e1 || !factor) throw e1 ?? new Error('enroll failed');
      const { error: e2 } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) });
      if (e2) throw e2;
      totpSecret = factor.totp.secret;
    }
    const admin = { email, password, totpSecret };
    if (key.includes('.')) {
      const [project, who] = key.split('.') as [string, string];
      out[project] = { ...((out[project] as Record<string, E2EAdmin>) ?? {}), [who]: admin };
    } else out[key] = admin;
  }
  for (const u of previous) {
    const { error } = await db.auth.admin.deleteUser(u.id);
    if (error) throw new Error(`could not delete old test admin ${u.email}: ${error.message}`);
  }
  mkdirSync('.playwright', { recursive: true });
  // Sessions from a previous run belong to deleted users.
  for (const f of readdirSync('.playwright')) if (f.startsWith('session-')) rmSync(`.playwright/${f}`);
  writeFileSync(ADMIN_FILE, JSON.stringify(out, null, 2));
}

async function removeFolder(db: ReturnType<typeof localDb>, folder: string): Promise<void> {
  const { data } = await db.storage.from('trip-images').list(folder, { limit: 1000 });
  if (data?.length) await db.storage.from('trip-images').remove(data.map((o) => `${folder}/${o.name}`));
}

/** Photos for the admin upload test (see tests/e2e/admin-photos.spec.ts). */
export const PHOTO_DIR = '.playwright/photos';
export const PHOTOS = {
  /** 1200×800 JPEG with GPS and camera EXIF, rotated 90° by its EXIF orientation (shows as 800×1200). */
  gps: `${PHOTO_DIR}/gps-rotated.jpg`,
  /** 2400×1600 PNG: resized to 1600 / 960 / 480 on the long side. */
  wide: `${PHOTO_DIR}/wide.png`,
  /** 200×150: rejected as too small. */
  tiny: `${PHOTO_DIR}/tiny.png`,
};

async function writeTestPhotos(): Promise<void> {
  mkdirSync(PHOTO_DIR, { recursive: true });
  const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#6b7a2e' } });
  await solid(1200, 800)
    .jpeg({ quality: 85 })
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'E2E', Copyright: 'Fresh Move e2e' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '36/1 45/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '3/1 3/1 0/1' },
    })
    .withMetadata({ orientation: 6 })
    .toFile(PHOTOS.gps);
  await solid(2400, 1600).png().toFile(PHOTOS.wide);
  await solid(200, 150).png().toFile(PHOTOS.tiny);
}

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export async function setupFixtures(): Promise<void> {
  const db = localDb();
  // Clean previous runs (reservations first: trips are ON DELETE RESTRICT).
  const { data: old } = await db.from('trips').select('id').or('slug.like.e2e-%,title_en.like.Admin E2E%');
  const ids = (old ?? []).map((t) => t.id);
  if (ids.length) {
    await db.from('reservations').delete().in('trip_id', ids);
    await db.from('trips').update({ cover_image_id: null }).in('id', ids);
    await db.from('trip_images').delete().in('trip_id', ids);
    await db.from('trips').delete().in('id', ids);
    for (const id of ids) await removeFolder(db, `trips/${id}`);
  }
  await writeTestPhotos();
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

  await setupAdmins(db);
}

export default setupFixtures;
