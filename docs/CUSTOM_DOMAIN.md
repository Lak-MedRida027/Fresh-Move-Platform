# Connecting a custom domain later

The site runs on the free `*.vercel.app` address for now. When the club buys a domain
(e.g. `freshmove.dz` or `freshmove.club`), follow these steps.

## 1. Add the domain in Vercel

1. Vercel dashboard → the project → **Settings → Domains → Add**.
2. Enter the domain, e.g. `freshmove.club`. Vercel suggests adding `www.freshmove.club` too; accept it
   and choose which one is primary (the other redirects to it).

## 2. Set the DNS records (at your domain registrar)

Vercel shows the exact values to use. They are usually:

| Type | Name | Value |
|---|---|---|
| `A` | `@` (the root domain) | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Always copy the values shown in your Vercel dashboard, since they can change. DNS can take from a few minutes to
48 hours. Vercel issues the HTTPS certificate automatically once DNS is correct.

For a `.dz` domain, the registrar is managed through CERIST / accredited resellers; the records are the same.

## 3. Tell the site its new address

The address appears in canonical URLs, `hreflang` links, the sitemap, Open Graph tags and JSON-LD.
Update it in **three** places:

1. **Vercel env var (recommended):** Settings → Environment Variables → add `SITE_URL` =
   `https://freshmove.club` for Production. `astro.config.mjs` reads it at build time.
   (Or change the fallback value in `astro.config.mjs` directly.)
2. `src/config/site.ts` → `SITE.url`.
3. `public/robots.txt` → the `Sitemap:` line.

Then redeploy.

## 4. Check

```bash
curl -sI https://freshmove.club | head -20          # 200 + security headers
curl -s https://freshmove.club/sitemap-index.xml    # URLs use the new domain
```

- View the page source: `<link rel="canonical">` and `og:url` use the new domain.
- Share the URL in an Instagram DM to yourself and check the preview card.
- Update the link in the Instagram bio.

## 5. Optional: HSTS preload

`vercel.json` already sends `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Once the
domain has worked over HTTPS for a while, you can add `; preload` and submit it at
<https://hstspreload.org>. This is hard to undo, so only do it if every subdomain will always use HTTPS.
