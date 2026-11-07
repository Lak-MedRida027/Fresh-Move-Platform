// Measurement helper: proxies the local preview (:4321) on :4322 with brotli,
// like Cloudflare's edge does in production, so Lighthouse numbers are realistic.
//   npx astro preview --port 4321 & node scripts/compress-proxy.mjs
import { createServer, request } from 'node:http';
import { brotliCompressSync } from 'node:zlib';

const TARGET = { host: 'localhost', port: 4321 };
createServer((req, res) => {
  const up = request({ ...TARGET, path: req.url, method: req.method, headers: { ...req.headers, 'accept-encoding': 'identity', host: 'localhost:4321' } }, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      let body = Buffer.concat(chunks);
      const headers = { ...r.headers };
      const type = String(headers['content-type'] ?? '');
      if (/text|javascript|json|xml|svg/.test(type) && String(req.headers['accept-encoding'] ?? '').includes('br')) {
        body = brotliCompressSync(body);
        headers['content-encoding'] = 'br';
      }
      headers['content-length'] = String(body.length);
      delete headers['transfer-encoding'];
      res.writeHead(r.statusCode ?? 500, headers);
      res.end(body);
    });
  });
  req.pipe(up);
}).listen(4322, () => console.log('compress-proxy on http://localhost:4322 → :4321'));
