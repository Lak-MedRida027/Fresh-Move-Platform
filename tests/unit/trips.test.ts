import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import { REGION_IDS } from '../../src/data/regions';
import { tripSchema } from '../../src/lib/trip-schema';
import { formatTripDate, sortTrips } from '../../src/lib/trips';

// Astro's content loaders don't run under Vitest, so read the files directly
// and validate them with the same schema the site uses. Image paths must
// resolve to real files.
const DIR = 'src/content/trips';
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
  it('formats dates per language and handles TBD', () => {
    expect(formatTripDate('2025-11', 'en')).toBe('November 2025');
    expect(formatTripDate('2025-11', 'ar')).toContain('2025');
    expect(formatTripDate('TBD', 'en')).toBe('Date to be confirmed');
  });

  it('sorts newest first with TBD last', () => {
    const mk = (slug: string, date: string) => ({ data: { slug, date, title: { en: slug } } }) as never;
    const sorted = sortTrips([mk('a', 'TBD'), mk('b', '2024-05'), mk('c', '2025-01')]);
    expect(sorted.map((t: { data: { slug: string } }) => t.data.slug)).toEqual(['c', 'b', 'a']);
  });
});
