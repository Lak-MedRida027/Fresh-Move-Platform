// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

// Change SITE_URL (or this fallback) when a custom domain is connected. See docs/CUSTOM_DOMAIN.md.
const SITE = process.env.SITE_URL ?? 'https://fresh-move.vercel.app';

export default defineConfig({
  site: SITE,
  output: 'static',
  adapter: vercel(),
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
    // Keep CSS in external files so the CSP can use style-src 'self' without 'unsafe-inline'.
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      // Astro inlines small bundled scripts below this limit. 0 keeps every
      // script external so the CSP only has to allow the theme bootstrap hash.
      assetsInlineLimit: 0,
      // One stylesheet for the whole site (~30 KB, ~7 KB compressed) instead of
      // several render-blocking files per page.
      cssCodeSplit: false,
    },
  },
  i18n: {
    locales: ['ar', 'en'],
    defaultLocale: 'ar',
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'ar', locales: { ar: 'ar-DZ', en: 'en' } },
      filter: (page) => !page.includes('/api/') && !/\/404\/?$/.test(page),
    }),
  ],
});
