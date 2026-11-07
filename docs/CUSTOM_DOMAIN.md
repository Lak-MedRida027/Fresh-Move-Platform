# Connecting a custom domain later

The site runs on the free `fresh-move.<subdomain>.workers.dev` address. A domain of your own (e.g.
`freshmove.club`, or a `.dz` through an accredited reseller) is the best upgrade: it's easier to share,
and it turns on Cloudflare's edge cache for the pages (not available on `*.workers.dev`), so the site gets
faster and uses less of the free quotas.

## 1. Put the domain on Cloudflare

Cloudflare can only attach a Worker to a domain whose DNS it manages (the free plan is fine).

1. Cloudflare dashboard → **Add a domain** → enter it → **Free** plan.
2. Cloudflare shows two **nameservers**. At your registrar, replace the domain's nameservers with those
   two. This can take from minutes to a day; Cloudflare emails you when the domain is active.

## 2. Attach the Worker

Workers & Pages → **fresh-move** → **Settings → Domains & Routes → Add → Custom domain** → enter the
domain (e.g. `freshmove.club`), then add `www.freshmove.club` the same way if you want both. Cloudflare
creates the DNS records and the HTTPS certificate.

## 3. Tell everything about the new address

1. **`.env.production`**: `SITE_URL=https://freshmove.club`, then `npm run deploy`. (Canonical links,
   `hreflang`, the sitemap, `robots.txt` and social cards use it.)
2. **Supabase** → Authentication → **URL Configuration**: set **Site URL** to the new address (the
   admin emails link to it) and add `https://freshmove.club/**` to **Redirect URLs**.
3. **Turnstile** → your widget → **Hostname management**: add the new domain.
4. **Old address:** in `vercel-redirect/vercel.json`, point the destination to the new domain and push,
   so the v1 address keeps forwarding.
5. **GitHub** → Settings → Secrets and variables → Actions → Variables: nothing to change (the backup
   talks to Supabase directly).
6. Update the **Instagram bio** link.
7. Check: `npm run smoke -- https://freshmove.club`.

The `workers.dev` address keeps working; you can turn it off in the Worker's **Domains & Routes** once
the new domain is live.
