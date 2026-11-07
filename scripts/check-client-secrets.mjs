// Fails the build if a server-only secret (name or actual value) appears in
// anything served to browsers (dist/client). Runs after every build.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'dist/client';
const NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'CRON_SECRET', 'sb_secret_'];
const values = [];
for (const file of ['.dev.vars']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const v = line.split('=').slice(1).join('=').trim();
    if (v.length >= 12) values.push(v);
  }
}
for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'CRON_SECRET']) {
  const v = process.env[name];
  if (v && v.length >= 12) values.push(v);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const leaks = [];
for (const file of walk(ROOT)) {
  if (!/\.(js|mjs|html|css|json|txt|xml|webmanifest|map)$|_headers$|_redirects$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const n of NAMES) if (text.includes(n)) leaks.push(`${file}: name ${n}`);
  for (const v of values) if (text.includes(v)) leaks.push(`${file}: a secret value`);
}
if (leaks.length) {
  console.error('✗ Server-only secrets found in client files:\n' + leaks.join('\n'));
  process.exit(1);
}
console.log(`✓ no server-only secrets in ${ROOT}`);
