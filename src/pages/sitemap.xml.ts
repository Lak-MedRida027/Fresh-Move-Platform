import type { APIRoute } from 'astro';
import { LOCALES, LOCALE_META, localizePath } from '../i18n';
import { getTrips } from '../lib/trips';

// Lists the static pages plus every published trip, with hreflang alternates.
const STATIC_PATHS = ['/', '/trips/', '/join/', '/privacy/'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const GET: APIRoute = async ({ site, cache }) => {
  const base = site ?? new URL('http://localhost:4321');
  const trips = await getTrips().catch(() => []);
  const paths = [...STATIC_PATHS, ...trips.map((t) => `/trips/${t.slug}/`)];
  const urls = paths.flatMap((p) =>
    LOCALES.map((locale) => {
      const alternates = LOCALES.map(
        (l) =>
          `<xhtml:link rel="alternate" hreflang="${LOCALE_META[l].hreflang}" href="${esc(new URL(localizePath(p, l), base).href)}"/>`,
      ).join('');
      return `<url><loc>${esc(new URL(localizePath(p, locale), base).href)}</loc>${alternates}</url>`;
    }),
  );
  if (cache?.enabled) cache.set({ maxAge: 3600, swr: 3600, tags: ['trips'] });
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
