import { z } from 'astro/zod';
import { REGION_IDS, TERRAINS } from '../data/regions';

const bilingual = z.object({ ar: z.string().trim().min(1), en: z.string().trim().min(1) });

/**
 * Trip frontmatter schema. `imageSchema` is Astro's image() helper in
 * content.config.ts, and a plain path check in the unit tests.
 */
export function tripSchema<T extends z.ZodType>(imageSchema: () => T) {
  return z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase-words-with-hyphens'),
    title: bilingual,
    region: z.enum(REGION_IDS),
    terrain: z.array(z.enum(TERRAINS)).min(1),
    date: z.union([z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM'), z.literal('TBD')]),
    summary: bilingual,
    cover: imageSchema(),
    gallery: z.array(imageSchema()).default([]),
    instagramPostUrl: z.url().optional(),
    featured: z.boolean().default(false),
  });
}
