// Production smoke check: npm run smoke -- https://your-site
//
// Read-only. It never creates data: the two POSTs it sends are ones the site
// must refuse (the cron endpoint without the secret, and a booking with
// Cloudflare's dummy Turnstile token for a trip that doesn't exist).
// Prints one line per check and exits non-zero if any fails.
import { randomUUID } from 'node:crypto';

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error('Usage: npm run smoke -- https://fresh-move.<subdomain>.workers.dev');
  process.exit(1);
}

let failed = 0;
const check = async (name, fn) => {
  try {
    const note = await fn();
    console.log(`ok    ${name}${note ? ` (${note})` : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const get = (path, init) => fetch(base + path, { redirect: 'manual', ...init });

await check('home page in Darja (right-to-left)', async () => {
  const res = await get('/');
  const html = await res.text();
  expect(res.status === 200, `status ${res.status}`);
  const tag = /<html[^>]*>/.exec(html)?.[0] ?? '';
  expect(/lang="ar(-[A-Z]{2})?"/.test(tag) && /dir="rtl"/.test(tag), 'no lang="ar…" dir="rtl"');
});

await check('home page in English', async () => {
  const res = await get('/en/');
  expect(res.status === 200, `status ${res.status}`);
  expect(/<html[^>]*lang="en"/.test(await res.text()), 'no lang="en"');
});

await check('security headers', async () => {
  const h = (await get('/')).headers;
  const csp = h.get('content-security-policy') ?? '';
  expect(/script-src 'self' 'sha256-/.test(csp), 'CSP missing or without the script hash');
  expect(!/script-src[^;]*'unsafe-inline'/.test(csp), "CSP allows 'unsafe-inline' scripts");
  expect(/\.supabase\.co/.test(csp), 'CSP does not allow the Supabase project (built with local values?)');
  expect(h.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options');
  expect(h.get('x-frame-options') === 'DENY', 'X-Frame-Options');
  expect(/max-age=\d+/.test(h.get('strict-transport-security') ?? ''), 'Strict-Transport-Security');
  expect(!!h.get('referrer-policy') && !!h.get('permissions-policy'), 'Referrer-Policy / Permissions-Policy');
});

let photo = null;
await check('trips page lists trips from the database', async () => {
  const res = await get('/trips/');
  const html = await res.text();
  expect(res.status === 200, `status ${res.status}`);
  const n = (html.match(/data-trip[\s=>]/g) ?? []).length;
  expect(n > 0, 'no trips (database empty or unreachable?)');
  // (Any host: the security-headers check already confirms the production Supabase project.)
  photo = /(https?:\/\/[^"\s,]+\/storage\/v1\/object\/public\/trip-images\/[^"\s,]+\.webp)/.exec(html)?.[1] ?? null;
  return `${n} trip cards`;
});

await check('trip photos load from storage', async () => {
  expect(photo, 'no photo URL on the trips page');
  const res = await fetch(photo);
  expect(res.ok, `status ${res.status}`);
  expect(res.headers.get('content-type') === 'image/webp', `content-type ${res.headers.get('content-type')}`);
});

await check('robots.txt keeps search engines out of /admin and points to the sitemap', async () => {
  const txt = await (await get('/robots.txt')).text();
  expect(/Disallow: \/admin/.test(txt), 'no Disallow: /admin');
  expect(txt.includes(`Sitemap: ${base}/`), `Sitemap line doesn't use ${base} (SITE_URL wrong?)`);
});

await check('admin pages need a sign-in and are not indexed', async () => {
  const res = await get('/admin/');
  expect([302, 303].includes(res.status), `status ${res.status}`);
  expect(/\/admin\/login\/$/.test(res.headers.get('location') ?? ''), `redirects to ${res.headers.get('location')}`);
  const login = await get('/admin/login/');
  expect(login.status === 200, `login page status ${login.status}`);
  expect((login.headers.get('x-robots-tag') ?? '').includes('noindex'), 'no X-Robots-Tag: noindex');
});

await check('admin API refuses anonymous calls', async () => {
  const res = await get('/admin/api/trips/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: 'action=delete&id=x' });
  expect(res.status === 401, `status ${res.status}`);
});

await check('cron endpoint refuses calls without the secret', async () => {
  const res = await get('/api/cron/daily', { method: 'POST' });
  expect(res.status === 401, `status ${res.status}`);
});

await check('bookings need a real Turnstile check (production secret, not the test one)', async () => {
  const res = await get('/api/reserve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      tripId: randomUUID(), // no such trip: nothing can be created
      fullName: 'Smoke Check',
      phone: '0550000000',
      wilaya: '16',
      age: 30,
      consent: true,
      lang: 'en',
      website: '',
      startedAt: Date.now() - 10_000,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) return 'rate limited right now; run again in a minute';
  expect(body.error !== 'not_found', 'the dummy token was accepted: TURNSTILE_SECRET_KEY is a test key');
  expect(res.status === 400 && body.error === 'captcha', `status ${res.status} ${body.error ?? ''}`);
});

await check('unknown pages answer 404', async () => {
  const res = await get(`/no-such-page-${Date.now()}/`);
  expect(res.status === 404, `status ${res.status}`);
});

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
