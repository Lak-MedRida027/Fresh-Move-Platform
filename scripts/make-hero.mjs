// Pre-sizes the home hero photo into public/hero/ (WebP, 4 widths). Cloudflare's
// runtime has no sharp, so local brand images are prepared ahead of time.
//   node scripts/make-hero.mjs        (re-run after replacing src/assets/hero/hero.jpg)
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

export const HERO_WIDTHS = [640, 960, 1280, 1920];
const SRC = 'src/assets/hero/hero.jpg';
await mkdir('public/hero', { recursive: true });
const meta = await sharp(SRC).metadata();
for (const w of HERO_WIDTHS) {
  await sharp(SRC).rotate().resize(w).webp({ quality: 72 }).toFile(`public/hero/hero-${w}.webp`);
}
console.log(`hero: ${HERO_WIDTHS.length} sizes from ${meta.width}x${meta.height}`);
