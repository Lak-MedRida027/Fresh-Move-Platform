/**
 * Seeds the v1 trips (src/content/trips/*.md) into Supabase as `completed`
 * trips, keeping their slugs so existing URLs keep working. Each cover/gallery
 * image is resized to sm/md/lg WebP (480/960/1600 px long side) plus a tiny
 * blurred placeholder, uploaded to Storage `trip-images`, and linked.
 *
 * Local (default):  node scripts/with-local-supabase.mjs node scripts/seed-trips.ts
 * Production:       SEED_SUPABASE_URL=… SEED_SUPABASE_SECRET_KEY=… node scripts/seed-trips.ts --production
 * Idempotent: trips whose slug already exists are skipped.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { parse } from 'yaml';

const url = process.env.SEED_SUPABASE_URL ?? process.env.SUPABASE_TEST_URL;
const key = process.env.SEED_SUPABASE_SECRET_KEY ?? process.env.SUPABASE_TEST_SECRET_KEY;
if (!url || !key) throw new Error('Set SEED_SUPABASE_URL and SEED_SUPABASE_SECRET_KEY (or run via with-local-supabase).');
const host = new URL(url).hostname;
const isLocal = host === '127.0.0.1' || host === 'localhost';
if (!isLocal && !process.argv.includes('--production')) {
  throw new Error(`${host} is not local. Pass --production to seed a hosted project on purpose.`);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const DIR = 'supabase/seed-data/trips';
const SIZES = { sm: 480, md: 960, lg: 1600 } as const;

interface Front {
  slug: string;
  title: { ar: string; en: string };
  region: string;
  terrain: string[];
  date: string;
  summary: { ar: string; en: string };
  cover: string;
  gallery?: string[];
  instagramPostUrl?: string;
  featured?: boolean;
}

async function uploadImage(tripId: string, file: string, kind: 'poster' | 'gallery', sort: number, alt: { ar: string; en: string }) {
  const id = randomUUID();
  const input = sharp(file).rotate(); // apply EXIF orientation; output has no metadata
  const meta = await input.metadata();
  const paths: Record<string, string> = {};
  let total = 0;
  let lg = { width: meta.width ?? 1, height: meta.height ?? 1 };
  for (const [size, px] of Object.entries(SIZES)) {
    const { data, info } = await sharp(file)
      .rotate()
      .resize(px, px, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const path = `trips/${tripId}/${id}-${size}.webp`;
    const { error } = await db.storage.from('trip-images').upload(path, data, { contentType: 'image/webp', upsert: true });
    if (error) throw error;
    paths[size] = path;
    total += data.length;
    if (size === 'lg') lg = { width: info.width, height: info.height };
  }
  const tiny = await sharp(file).rotate().resize(16, 16, { fit: 'inside' }).webp({ quality: 40 }).toBuffer();
  const { error } = await db.from('trip_images').insert({
    id,
    trip_id: tripId,
    kind,
    path_sm: paths.sm!,
    path_md: paths.md!,
    path_lg: paths.lg!,
    width: lg.width,
    height: lg.height,
    placeholder: `data:image/webp;base64,${tiny.toString('base64')}`,
    size_bytes: total,
    alt_ar: alt.ar,
    alt_en: alt.en,
    sort_order: sort,
  });
  if (error) throw error;
  return id;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
let created = 0;
let skipped = 0;
for (const f of files) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const front = parse(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '') as Front;
  const { data: existing } = await db.from('trips').select('id').eq('slug', front.slug).maybeSingle();
  if (existing) {
    skipped++;
    continue;
  }
  const month = /^\d{4}-\d{2}$/.test(front.date) ? `${front.date}-01` : null;
  const { data: trip, error } = await db
    .from('trips')
    .insert({
      slug: front.slug,
      title_ar: front.title.ar,
      title_en: front.title.en,
      summary_ar: front.summary.ar,
      summary_en: front.summary.en,
      region: front.region,
      terrain: front.terrain,
      start_date: month,
      end_date: month,
      status: 'completed',
      featured: front.featured ?? false,
      instagram_post_url: front.instagramPostUrl ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;

  const abs = (p: string) => resolve(DIR, p);
  // TODO(owner): these are generated placeholder photos; replace them in the admin.
  const coverId = await uploadImage(trip.id, abs(front.cover), 'poster', 0, {
    ar: `${front.title.ar} (صورة مؤقتة)`,
    en: `${front.title.en} (placeholder photo)`,
  });
  let i = 1;
  for (const g of front.gallery ?? []) {
    await uploadImage(trip.id, abs(g), 'gallery', i, {
      ar: `${front.title.ar}، صورة ${i} (صورة مؤقتة)`,
      en: `${front.title.en}, photo ${i} (placeholder)`,
    });
    i++;
  }
  await db.from('trips').update({ cover_image_id: coverId }).eq('id', trip.id);
  created++;
  console.log(`seeded ${front.slug}`);
}
console.log(`done: ${created} created, ${skipped} already present (${host})`);
