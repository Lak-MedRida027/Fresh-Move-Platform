// Writes .env and .dev.vars for local development from the running local
// Supabase stack (its well-known local dev keys) and Cloudflare's Turnstile
// test keys. Never touches production values.   npm run setup:local
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const s = JSON.parse(
  execFileSync(npx, ['supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: process.platform === 'win32',
  }),
);
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(s.API_URL)) throw new Error('Not a local stack');

writeFileSync(
  '.env',
  [
    'SITE_URL=http://localhost:4321',
    `PUBLIC_SUPABASE_URL=${s.API_URL}`,
    `PUBLIC_SUPABASE_ANON_KEY=${s.PUBLISHABLE_KEY}`,
    'PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA',
    '',
  ].join('\n'),
);
writeFileSync(
  '.dev.vars',
  [
    `SUPABASE_SERVICE_ROLE_KEY=${s.SECRET_KEY}`,
    'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
    `CRON_SECRET=${randomBytes(24).toString('hex')}`,
    '',
  ].join('\n'),
);
console.log('.env and .dev.vars written for the local stack');
