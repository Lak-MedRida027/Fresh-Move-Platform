// Production deploy: npm run deploy
//
// Reads every build-time value from ONE file, .env.production (gitignored),
// checks none of them is a local or test value, then builds and runs
// `wrangler deploy`. Secrets are NOT in that file: they live in Cloudflare
// (npx wrangler secret put …). See docs/DEPLOY.md.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FILE = '.env.production';
let text;
try {
  text = readFileSync(FILE, 'utf8');
} catch {
  console.error(`${FILE} is missing. Copy .env.production.example to ${FILE} and fill it in (docs/DEPLOY.md, step 5).`);
  process.exit(1);
}
const vars = Object.fromEntries(
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const problems = [];
const need = (name, test, hint) => {
  if (!vars[name]) problems.push(`${name} is empty`);
  else if (!test(vars[name])) problems.push(`${name}: ${hint}`);
};
need('SITE_URL', (v) => /^https:\/\/[^/]+$/.test(v) && !/localhost|127\.0\.0\.1/.test(v), 'the site address, https://… with no trailing slash');
need('PUBLIC_SUPABASE_URL', (v) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v), 'https://<project-ref>.supabase.co');
need('PUBLIC_SUPABASE_ANON_KEY', (v) => /^sb_publishable_/.test(v) || /^eyJ/.test(v), 'the publishable key (sb_publishable_…)');
need('PUBLIC_TURNSTILE_SITE_KEY', (v) => !/^[123]x0000/.test(v), "the real Turnstile site key, not Cloudflare's test key");
for (const [k, v] of Object.entries(vars)) {
  if (/SECRET|SERVICE_ROLE/.test(k) || /^sb_secret_/.test(v)) problems.push(`${k}: secrets don't belong in ${FILE} (they'd be bundled into the site). Use: npx wrangler secret put ${k}`);
}
if (problems.length) {
  console.error(`${FILE} isn't ready:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

// Process environment beats .env files for Vite, astro.config.mjs and write-headers.
const env = { ...process.env, ...vars };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const step = (cmd, args) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
console.log(`Deploying ${vars.SITE_URL} (Supabase ${new URL(vars.PUBLIC_SUPABASE_URL).hostname})`);
step(npm, ['run', 'build']);
step(npx, ['wrangler', 'deploy']);
console.log(`\nDeployed. Next: npm run smoke -- ${vars.SITE_URL}`);
