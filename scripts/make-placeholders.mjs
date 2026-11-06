// Generates tasteful placeholder photos (dark, earthy SVG landscapes rendered
// to JPG) for every trip, the hero and the OG background. Nothing is scraped
// or downloaded. Re-run any time:  node scripts/make-placeholders.mjs
// Real photos simply replace these files (same names) — see docs/ADDING_A_TRIP.md.
import { mkdir, readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const TRIPS_DIR = 'src/content/trips';
const ASSETS = 'src/assets';
const force = process.argv.includes('--force');

/** Small deterministic PRNG so images are stable between runs. */
function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

function ridge(r, w, h, base, amp, steps, jag = 0.5) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * w;
    const y = base + (r() - 0.5) * amp + Math.sin(i * jag + r()) * amp * 0.35;
    pts.push(`${x.toFixed(1)},${Math.max(h * 0.12, y).toFixed(1)}`);
  }
  return `M0,${h} L${pts.join(' L')} L${w},${h} Z`;
}

function peaks(r, w, h, base, height, count) {
  let d = `M0,${h} L0,${base}`;
  const step = w / count;
  for (let i = 0; i < count; i++) {
    const x0 = i * step;
    const px = x0 + step * (0.3 + r() * 0.4);
    const py = base - height * (0.45 + r() * 0.55);
    d += ` L${px.toFixed(1)},${py.toFixed(1)} L${(x0 + step).toFixed(1)},${(base - r() * height * 0.2).toFixed(1)}`;
  }
  return `${d} L${w},${h} Z`;
}

function stars(r, w, n, maxY) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const op = (0.25 + r() * 0.6).toFixed(2);
    s += `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * maxY).toFixed(0)}" r="${(0.6 + r() * 1.4).toFixed(1)}" fill="#E8E5E0" opacity="${op}"/>`;
  }
  return s;
}

const scenes = {
  mountain(r, w, h) {
    const sunX = w * (0.2 + r() * 0.6);
    return `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#141a16"/><stop offset="0.55" stop-color="#3b4a33"/><stop offset="1" stop-color="#8a7a4e"/>
        </linearGradient>
        <radialGradient id="sun" cx="${sunX / w}" cy="0.55" r="0.35"><stop offset="0" stop-color="#C4A96A" stop-opacity="0.55"/><stop offset="1" stop-color="#C4A96A" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      <rect width="${w}" height="${h}" fill="url(#sun)"/>
      <path d="${peaks(r, w, h, h * 0.62, h * 0.38, 4)}" fill="#4a5a3e" opacity="0.75"/>
      <path d="${peaks(r, w, h, h * 0.72, h * 0.32, 5)}" fill="#3A5A3A"/>
      <path d="${ridge(r, w, h, h * 0.8, h * 0.08, 12)}" fill="#24331f"/>
      <path d="${ridge(r, w, h, h * 0.9, h * 0.05, 18)}" fill="#141a12"/>`;
  },
  desert(r, w, h) {
    return `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1a1410"/><stop offset="0.5" stop-color="#5a3a20"/><stop offset="1" stop-color="#C4A96A"/>
        </linearGradient>
        <linearGradient id="dune" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8925a"/><stop offset="1" stop-color="#6e4a26"/></linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      ${stars(r, w, 60, h * 0.35)}
      <path d="M${w * 0.62},${h * 0.62} L${w * 0.64},${h * 0.38} L${w * 0.7},${h * 0.33} L${w * 0.74},${h * 0.4} L${w * 0.76},${h * 0.62} Z" fill="#3a2414"/>
      <path d="M${w * 0.15},${h * 0.66} L${w * 0.17},${h * 0.48} L${w * 0.22},${h * 0.45} L${w * 0.24},${h * 0.66} Z" fill="#2e1c10"/>
      <path d="${ridge(r, w, h, h * 0.68, h * 0.06, 6, 0.9)}" fill="url(#dune)"/>
      <path d="${ridge(r, w, h, h * 0.8, h * 0.07, 5, 1.1)}" fill="#8a6234"/>
      <path d="${ridge(r, w, h, h * 0.9, h * 0.04, 6, 0.8)}" fill="#2A1E10"/>`;
  },
  coast(r, w, h) {
    return `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0f1a22"/><stop offset="0.6" stop-color="#3d6070"/><stop offset="1" stop-color="#c9a974"/>
        </linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5B8FA8"/><stop offset="1" stop-color="#0f2430"/></linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      <rect y="${h * 0.58}" width="${w}" height="${h * 0.42}" fill="url(#sea)"/>
      <rect x="${w * 0.3}" y="${h * 0.58}" width="${w * 0.4}" height="2" fill="#E8E5E0" opacity="0.35"/>
      <path d="M${w},${h} L${w},${h * 0.35} L${w * 0.86},${h * 0.4} L${w * 0.78},${h * 0.52} L${w * 0.72},${h * 0.62} L${w * 0.66},${h} Z" fill="#1d2a22"/>
      <path d="M0,${h} L0,${h * 0.5} L${w * 0.1},${h * 0.55} L${w * 0.2},${h * 0.66} L${w * 0.28},${h} Z" fill="#16201a"/>
      <path d="${ridge(r, w, h, h * 0.93, h * 0.02, 20)}" fill="#0c1410"/>`;
  },
  camping(r, w, h) {
    const tx = w * (0.35 + r() * 0.25);
    const ty = h * 0.8;
    return `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b0d10"/><stop offset="0.7" stop-color="#1e2420"/><stop offset="1" stop-color="#3a2a18"/>
        </linearGradient>
        <radialGradient id="fire" cx="${(tx + w * 0.16) / w}" cy="0.82" r="0.32"><stop offset="0" stop-color="#B85C38" stop-opacity="0.85"/><stop offset="0.4" stop-color="#B85C38" stop-opacity="0.25"/><stop offset="1" stop-color="#B85C38" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      ${stars(r, w, 140, h * 0.55)}
      <path d="${peaks(r, w, h, h * 0.7, h * 0.25, 5)}" fill="#151b16"/>
      <rect width="${w}" height="${h}" fill="url(#fire)"/>
      <path d="${ridge(r, w, h, h * 0.84, h * 0.02, 16)}" fill="#0e110d"/>
      <path d="M${tx - w * 0.09},${ty} L${tx},${ty - h * 0.2} L${tx + w * 0.09},${ty} Z" fill="#2a2018"/>
      <path d="M${tx - w * 0.02},${ty} L${tx},${ty - h * 0.08} L${tx + w * 0.02},${ty} Z" fill="#B85C38" opacity="0.6"/>
      <path d="M${tx + w * 0.15},${ty} q${w * 0.012},${-h * 0.07} ${w * 0.02},${-h * 0.03} q${w * 0.006},${-h * 0.04} ${w * 0.014},${h * 0.03} Z" fill="#e0894f"/>`;
  },
  heritage(r, w, h) {
    const cols = Array.from({ length: 6 }, (_, i) => {
      const x = w * (0.2 + i * 0.1);
      const top = h * (0.38 + (i === 2 || i === 4 ? 0.12 : 0) + r() * 0.04);
      return `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${(w * 0.035).toFixed(0)}" height="${(h * 0.72 - top).toFixed(0)}" fill="#2e2216"/>`;
    }).join('');
    return `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#16120e"/><stop offset="0.55" stop-color="#6a4a28"/><stop offset="1" stop-color="#d1b27a"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      <path d="${ridge(r, w, h, h * 0.66, h * 0.05, 8)}" fill="#7a5a34" opacity="0.6"/>
      ${cols}
      <rect x="${w * 0.19}" y="${h * 0.36}" width="${w * 0.17}" height="${h * 0.03}" fill="#2e2216"/>
      <path d="${ridge(r, w, h, h * 0.76, h * 0.03, 14)}" fill="#3a2a18"/>
      <path d="${ridge(r, w, h, h * 0.9, h * 0.03, 14)}" fill="#1a1410"/>`;
  },
  diving(r, w, h) {
    let rays = '';
    for (let i = 0; i < 5; i++) {
      const x = w * (0.15 + r() * 0.7);
      rays += `<path d="M${x},0 L${x + w * 0.05},0 L${x + w * 0.18},${h} L${x + w * 0.08},${h} Z" fill="#E8E5E0" opacity="0.05"/>`;
    }
    let bubbles = '';
    for (let i = 0; i < 25; i++) {
      bubbles += `<circle cx="${(w * 0.55 + r() * w * 0.2).toFixed(0)}" cy="${(r() * h * 0.8).toFixed(0)}" r="${(2 + r() * 7).toFixed(1)}" fill="none" stroke="#E8E5E0" stroke-opacity="0.3"/>`;
    }
    return `
      <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4a8099"/><stop offset="0.5" stop-color="#1c4152"/><stop offset="1" stop-color="#07141b"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sea)"/>
      ${rays}${bubbles}
      <path d="${ridge(r, w, h, h * 0.86, h * 0.08, 14, 1.4)}" fill="#0b1c22"/>`;
  },
};

function svgFor(terrain, seed, w, h) {
  const r = rng(seed);
  const scene = scenes[terrain] ?? scenes.mountain;
  // Film grain-ish vignette keeps the cinematic mood.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${scene(r, w, h)}
    <defs><radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#vig)"/>
  </svg>`;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function render(svg, out) {
  if (!force && (await exists(out))) return false;
  await sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toFile(out);
  return true;
}

/** Reads `slug:` and `terrain:` from each trip's frontmatter. */
async function readTrips() {
  const files = (await readdir(TRIPS_DIR)).filter((f) => f.endsWith('.md'));
  const trips = [];
  for (const f of files) {
    const text = await readFile(join(TRIPS_DIR, f), 'utf8');
    const slug = text.match(/^slug:\s*['"]?([\w-]+)/m)?.[1];
    const terrain = text.match(/^terrain:\s*\[\s*['"]?(\w+)/m)?.[1] ?? 'mountain';
    if (slug) trips.push({ slug, terrain, gallery: 4 });
  }
  return trips;
}

const trips = await readTrips();
let made = 0;
for (const { slug, terrain, gallery } of trips) {
  const dir = join(ASSETS, 'trips', slug);
  await mkdir(dir, { recursive: true });
  if (await render(svgFor(terrain, `${slug}-cover`, 1600, 1000), join(dir, 'cover.jpg'))) made++;
  for (let i = 1; i <= gallery; i++) {
    const out = join(dir, `${String(i).padStart(2, '0')}.jpg`);
    if (await render(svgFor(terrain, `${slug}-${i}`, 1600, 1067), out)) made++;
  }
}

await mkdir(join(ASSETS, 'hero'), { recursive: true });
if (await render(svgFor('mountain', 'hero-main', 2400, 1350), join(ASSETS, 'hero', 'hero.jpg'))) made++;
await mkdir(join(ASSETS, 'og'), { recursive: true });
if (await render(svgFor('desert', 'og-bg', 1200, 630), join(ASSETS, 'og', 'og-bg.jpg'))) made++;

console.log(`placeholders: ${made} image(s) written for ${trips.length} trip(s)`);
