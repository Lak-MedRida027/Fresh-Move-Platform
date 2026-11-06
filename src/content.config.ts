import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { tripSchema } from './lib/trip-schema';

const trips = defineCollection({
  // One Markdown file per trip; all data lives in the frontmatter.
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/trips' }),
  schema: ({ image }) => tripSchema(image),
});

export const collections = { trips };
