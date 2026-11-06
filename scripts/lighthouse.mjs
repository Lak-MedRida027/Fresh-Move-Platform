// Lighthouse (mobile) on the key pages, median of N runs.
//   node scripts/lighthouse.mjs [baseUrl] [runs]
// Default base: http://localhost:4321 (npm run build && npm run serve:dist).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const base = (process.argv[2] ?? 'http://localhost:4321').replace(/\/$/, '');
const runs = Number(process.argv[3] ?? 3);
const pages = ['/', '/en/', '/trips/chelia-summit/', '/en/trips/chelia-summit/'];
const dir = mkdtempSync(join(tmpdir(), 'lh-'));
const chromePath = process.env.CHROME_PATH ?? chromium.executablePath();
const cats = ['performance', 'accessibility', 'best-practices', 'seo'];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const rows = [];
for (const path of pages) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const out = join(dir, `r${i}.json`);
    execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['lighthouse', `${base}${path}`, '--quiet', '--output=json', `--output-path=${out}`,
        `--only-categories=${cats.join(',')}`, '--chrome-flags=--headless=new --no-sandbox'],
      { env: { ...process.env, CHROME_PATH: chromePath }, stdio: 'ignore', shell: process.platform === 'win32' },
    );
    results.push(JSON.parse(readFileSync(out, 'utf8')));
  }
  const score = (c) => median(results.map((r) => Math.round(r.categories[c].score * 100)));
  const metric = (id) => median(results.map((r) => r.audits[id].numericValue));
  rows.push({
    page: path,
    perf: score('performance'),
    a11y: score('accessibility'),
    bp: score('best-practices'),
    seo: score('seo'),
    LCP: `${(metric('largest-contentful-paint') / 1000).toFixed(1)} s`,
    CLS: metric('cumulative-layout-shift').toFixed(3),
    TBT: `${Math.round(metric('total-blocking-time'))} ms`,
  });
}
console.table(rows);
const fail = rows.filter((r) => r.perf < 90 || r.a11y < 95 || r.bp < 95 || r.seo < 95);
if (fail.length) {
  console.error('Below target (perf ≥ 90, others ≥ 95):', fail.map((r) => r.page).join(', '));
  process.exitCode = 1;
}
