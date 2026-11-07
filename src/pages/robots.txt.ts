import type { APIRoute } from 'astro';

export const prerender = true;

// Generated so the Sitemap line always uses the site's real domain.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('/sitemap.xml', site).href;
  const rules = ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /admin/', 'Disallow: /en/admin/'];
  return new Response(`${rules.join('\n')}\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
