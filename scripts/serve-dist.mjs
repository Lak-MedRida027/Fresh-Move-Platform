// Serves the built site from dist/ with the headers from vercel.json, so the
// e2e tests run against the real Content-Security-Policy. /api/* is not served
// here (the e2e tests mock it). Usage: node scripts/serve-dist.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('dist');
const port = Number(process.argv[2] ?? process.env.PORT ?? 4321);
const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** vercel.json `source` patterns used here are simple path-to-regexp globs like /(.*) */
function headersFor(pathname) {
  const out = {};
  for (const rule of vercel.headers ?? []) {
    const re = new RegExp(`^${rule.source}$`);
    if (re.test(pathname)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

async function resolveFile(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(root, safe);
  if (!file.startsWith(root)) return null;
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    await stat(file);
    return file;
  } catch {
    try {
      const html = `${file}.html`;
      await stat(html);
      return html;
    } catch {
      return null;
    }
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const headers = headersFor(url.pathname);
  // Mirror Vercel: /en/trips -> /en/trips/ for directory pages
  const file = await resolveFile(url.pathname);
  if (file) {
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
    return;
  }
  // Like Vercel: every missing URL gets the root 404.html (it is bilingual).
  const page = await readFile(join(root, '404.html')).catch(() => null);
  res.writeHead(404, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page ?? 'Not found');
}).listen(port, () => {
  console.log(`serve-dist on http://localhost:${port}`);
});
