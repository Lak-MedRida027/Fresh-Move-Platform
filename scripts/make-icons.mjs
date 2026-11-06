// Builds the favicon set and web-app icons from public/brand/logo.*
//   node scripts/make-icons.mjs
// TODO(owner): the current logo is 150×150, so the large icons are upscaled
// and look soft. Drop a ≥1024px PNG (or SVG) in public/brand/ and re-run.
import { readdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const files = await readdir('public/brand');
const logoFile = ['logo.svg', 'logo.png', 'logo.webp', 'logo.jpg', 'logo.jpeg'].find((f) => files.includes(f));
if (!logoFile) throw new Error('No public/brand/logo.* found');
const logo = `public/brand/${logoFile}`;

const NIGHT_ROCK = '#1A1815';

/** Logo cropped to a circle on a transparent square (keeps the badge intact). */
async function circle(size, padding = 0) {
  const inner = Math.round(size - padding * 2);
  const mask = Buffer.from(
    `<svg width="${inner}" height="${inner}"><circle cx="${inner / 2}" cy="${inner / 2}" r="${inner / 2}"/></svg>`,
  );
  const round = await sharp(logo)
    .resize(inner, inner, { fit: 'cover', kernel: 'lanczos3' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: round, left: padding, top: padding }])
    .png();
}

/** Logo on a solid square (Apple touch icon / maskable icon need opaque backgrounds). */
async function solid(size, padding) {
  const round = await (await circle(size - padding * 2)).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: NIGHT_ROCK } })
    .composite([{ input: round, left: padding, top: padding }])
    .png();
}

/** PNG-in-ICO container (supported by every current browser). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const png16 = await (await circle(16)).toBuffer();
const png32 = await (await circle(32)).toBuffer();
const png48 = await (await circle(48)).toBuffer();
await writeFile('public/favicon.ico', ico([
  { size: 16, data: png16 },
  { size: 32, data: png32 },
  { size: 48, data: png48 },
]));
await (await circle(32)).toFile('public/favicon-32x32.png');
await (await solid(180, 14)).toFile('public/apple-touch-icon.png');
await (await circle(192)).toFile('public/icon-192.png');
await (await circle(512)).toFile('public/icon-512.png');
// Maskable: logo inside the 80% safe zone.
await (await solid(512, 56)).toFile('public/icon-maskable-512.png');

console.log(`icons built from ${logo}`);
