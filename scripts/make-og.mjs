// Renders the branded Open Graph images (1200×630) with the real brand fonts:
// an HTML card is screenshotted by Playwright's Chromium. Run after changing
// the logo or tagline:   node scripts/make-og.mjs
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Fonts are inlined as data URIs (a setContent page can't load file:// URLs).
const fontData = {};
for (const [key, pkg, name] of [
  ['oswald', 'oswald', 'oswald-latin-700-normal.woff2'],
  ['inter', 'inter', 'inter-latin-500-normal.woff2'],
  ['arabic', 'noto-sans-arabic', 'noto-sans-arabic-arabic-700-normal.woff2'],
]) {
  fontData[key] = `data:font/woff2;base64,${(await readFile(`node_modules/@fontsource/${pkg}/files/${name}`)).toString('base64')}`;
}
const bg = `data:image/jpeg;base64,${(await readFile('src/assets/og/og-bg.jpg')).toString('base64')}`;
const logo = `data:image/jpeg;base64,${(await readFile('public/brand/logo.jpg')).toString('base64')}`;

const css = `
@font-face { font-family: Oswald; font-weight: 700; src: url(${fontData.oswald}); }
@font-face { font-family: Inter; font-weight: 500; src: url(${fontData.inter}); }
@font-face { font-family: 'Noto Sans Arabic'; font-weight: 700; src: url(${fontData.arabic}); }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; background: #0F0F0F; color: #E8E5E0; }
.card { position: relative; width: 1200px; height: 630px; display: flex; align-items: center; gap: 56px; padding: 0 80px;
  background: linear-gradient(90deg, rgba(15,15,15,.92) 0%, rgba(42,30,16,.7) 55%, rgba(15,15,15,.25) 100%), url(${bg}) center/cover; }
.logo { width: 220px; height: 220px; border-radius: 50%; flex: none; box-shadow: 0 0 0 6px #E8E5E0, 0 20px 60px rgba(0,0,0,.5); }
.brand { font: 700 92px/1 Oswald, sans-serif; letter-spacing: .05em; text-transform: uppercase; }
.tag { margin-top: 22px; font: 700 50px/1.35 'Noto Sans Arabic', Oswald, sans-serif; direction: rtl; width: fit-content; }
.pillars { margin-top: 26px; font: 500 26px/1.4 Inter, sans-serif; color: #C4A96A; letter-spacing: .04em; }
.handle { position: absolute; right: 48px; bottom: 36px; font: 500 22px Inter, sans-serif; color: rgba(232,229,224,.8); }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 8px; background: linear-gradient(90deg,#3A5A3A,#C4A96A,#B85C38,#5B8FA8); }
`;

const variants = {
  ar: { pillars: 'سفر · طبيعة · تاريخ · مغامرة', pillarsFont: "'Noto Sans Arabic'" },
  en: { pillars: 'Travel · Nature · History · Adventure', pillarsFont: 'Inter' },
};

await mkdir('public/og', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [lang, v] of Object.entries(variants)) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
    .pillars { font-family: ${v.pillarsFont}, Inter, sans-serif; }</style></head><body>
    <div class="card">
      <img class="logo" src="${logo}" alt="">
      <div>
        <div class="brand">Fresh Move</div>
        <div class="tag">El move لي تفرح القلب 🍀</div>
        <div class="pillars" dir="auto">${v.pillars}</div>
      </div>
      <div class="handle">@fresh_move1</div>
      <div class="bar"></div>
    </div></body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const ok = ['700 10px Oswald', '700 10px "Noto Sans Arabic"', '500 10px Inter'].every((f) => document.fonts.check(f));
    if (!ok) throw new Error('OG fonts failed to load');
  });
  await page.screenshot({ path: `public/og/og-${lang}.png`, type: 'png' });
}
await browser.close();
console.log('public/og/og-ar.png and public/og/og-en.png written');
