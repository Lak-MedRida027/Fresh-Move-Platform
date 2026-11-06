// Full-page screenshots of every page: dark/light × ar/en × mobile/desktop.
// Needs the built site served on BASE (default http://localhost:4321):
//   npm run build && npm run serve:dist   (in another terminal)
//   node scripts/screenshots.mjs [filter]
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const OUT = 'docs/screenshots';
const filter = process.argv[2] ?? '';

const pages = [
  ['home', '/'],
  ['trips', '/trips/'],
  ['trip', '/trips/chelia-summit/'],
  ['join', '/join/'],
  ['privacy', '/privacy/'],
  ['404', '/404/'],
];
const langs = [
  ['ar', ''],
  ['en', '/en'],
];
const themes = ['dark', 'light'];
const viewports = [
  ['mobile', { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }],
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let count = 0;
for (const [vpName, vp] of viewports) {
  for (const theme of themes) {
    const ctx = await browser.newContext({ ...vp, colorScheme: theme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    for (const [lang, prefix] of langs) {
      for (const [name, path] of pages) {
        const file = `${name}-${lang}-${theme}-${vpName}.jpg`;
        if (filter && !file.includes(filter)) continue;
        await page.goto(`${BASE}${prefix}${path}`, { waitUntil: 'networkidle' });
        // Scroll through the page so lazy images load, then wait for them.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          window.scrollTo(0, 0);
          await Promise.all(
            Array.from(document.images, (img) =>
              img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true }) || setTimeout(r, 3000)),
            ),
          );
          await document.fonts.ready;
        });
        await page.screenshot({ path: `${OUT}/${file}`, fullPage: true, type: 'jpeg', quality: 70 });
        count++;
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`${count} screenshots saved to ${OUT}/`);
