import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import { REGION_IDS } from '../../src/data/regions';
import { tripSchema } from '../../src/lib/trip-schema';
import { formatTripDate, sortTrips, toTrip, type Trip } from '../../src/lib/trips';
import { srcset } from '../../src/lib/media';

// Astro's content loaders don't run under Vitest, so read the files directly
// and validate them with the same schema the site uses. Image paths must
// resolve to real files.
const DIR = 'supabase/seed-data/trips';
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const trips = readdirSync(DIR)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .map((file) => {
    const raw = readFileSync(join(DIR, file), 'utf8');
    const front = raw.match(FRONTMATTER)?.[1] ?? '';
    const imagePath = () => z.string().transform((p) => ({ src: resolve(DIR, p) }));
    const data = tripSchema(imagePath).parse(parse(front));
    return { id: basename(file, '.md'), data };
  });

describe('trips collection', () => {
  it('has the 14 seed trips', () => {
    expect(trips.length).toBeGreaterThanOrEqual(14);
  });

  it('every trip has both languages and a cover image', () => {
    for (const { id, data } of trips) {
      expect(data.title.ar, `${id} title.ar`).not.toBe('');
      expect(data.title.en, `${id} title.en`).not.toBe('');
      expect(data.summary.ar, `${id} summary.ar`).not.toBe('');
      expect(data.summary.en, `${id} summary.en`).not.toBe('');
      expect(existsSync(data.cover.src), `${id} cover file ${data.cover.src}`).toBe(true);
    }
  });

  it('slug matches the file name and is unique', () => {
    const slugs = trips.map((t) => t.data.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const { id, data } of trips) expect(id).toBe(data.slug);
  });

  it('uses known regions and every gallery image exists', () => {
    for (const { id, data } of trips) {
      expect(REGION_IDS, id).toContain(data.region);
      for (const img of data.gallery) expect(existsSync(img.src), `${id} ${img.src}`).toBe(true);
    }
  });

  it('has exactly 6 featured trips for the home page', () => {
    expect(trips.filter((t) => t.data.featured)).toHaveLength(6);
  });
});

describe('trip helpers', () => {
  it('formats dates per language and handles a missing date', () => {
    expect(formatTripDate('2025-11-14', 'en')).toBe('November 2025');
    expect(formatTripDate('2025-11-14', 'ar')).toContain('2025');
    expect(formatTripDate(null, 'en')).toBe('Date to be confirmed');
  });

  it('sorts newest first with undated trips last', () => {
    const mk = (slug: string, startDate: string | null) =>
      ({ slug, startDate, title: { en: slug, ar: slug } }) as unknown as Trip;
    const sorted = sortTrips([mk('a', null), mk('b', '2024-05-01'), mk('c', '2025-01-01')]);
    expect(sorted.map((t) => t.slug)).toEqual(['c', 'b', 'a']);
  });

  it('maps a database row to the page model (cover, ordered gallery, URLs)', () => {
    const base = 'https://abcd.supabase.co';
    const img = (id: string, kind: string, sort: number) => ({
      id, kind, sort_order: sort, trip_id: 't1', width: 1600, height: 1000,
      path_sm: `trips/t1/${id}-sm.webp`, path_md: `trips/t1/${id}-md.webp`, path_lg: `trips/t1/${id}-lg.webp`,
      placeholder: 'data:image/webp;base64,AAA', size_bytes: 1, alt_ar: 'ص', alt_en: `alt ${id}`, created_at: '',
    });
    const trip = toTrip(
      {
        id: 't1', slug: 'jijel', title_ar: 'جيجل', title_en: 'Jijel', summary_ar: '', summary_en: '',
        description_ar: '', description_en: '', region: 'kabylie-north-coast', terrain: ['coast'],
        difficulty: null, start_date: null, end_date: null, meeting_point_ar: null, meeting_point_en: null,
        meeting_time: null, price_da: null, capacity: null, hold_hours: 48, registration_deadline: null,
        payment_instructions_ar: '', payment_instructions_en: '', what_to_bring_ar: '', what_to_bring_en: '',
        status: 'completed', instagram_post_url: null, featured: true, cover_image_id: 'p', created_at: '', updated_at: '',
        images: [img('g2', 'gallery', 2), img('p', 'poster', 0), img('g1', 'gallery', 1)],
      } as never,
      base,
    );
    expect(trip.cover?.id).toBe('p');
    expect(trip.gallery.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(trip.cover?.src).toBe(`${base}/storage/v1/object/public/trip-images/trips/t1/p-md.webp`);
    expect(trip.cover?.srcset).toBe(
      `${base}/storage/v1/object/public/trip-images/trips/t1/p-sm.webp 480w, ` +
        `${base}/storage/v1/object/public/trip-images/trips/t1/p-md.webp 960w, ` +
        `${base}/storage/v1/object/public/trip-images/trips/t1/p-lg.webp 1600w`,
    );
  });

  it('srcset scales width descriptors for portrait posters', () => {
    const s = srcset({ width: 1280, height: 1600, path_sm: 'a', path_md: 'b', path_lg: 'c' }, 'https://x.co');
    expect(s).toContain('/a 384w');
    expect(s).toContain('/b 768w');
    expect(s).toContain('/c 1280w');
  });
});
