// Fails (exit 1) if plpgsql lint or the Security/Performance Advisors report anything.
//   node scripts/db-check.mjs        (local stack)
import { execFileSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let failed = false;
for (const [label, args] of [
  ['plpgsql lint', ['supabase', 'db', 'lint', '--level', 'warning', '--output-format', 'json']],
  ['advisors (security + performance)', ['supabase', 'db', 'advisors', '--output-format', 'json']],
]) {
  const out = execFileSync(npx, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' });
  const json = JSON.parse(out.trim().split('\n').pop());
  if (json.results?.length) {
    failed = true;
    console.error(`✗ ${label}:`);
    console.error(JSON.stringify(json.results, null, 2));
  } else {
    console.log(`✓ ${label}: no issues`);
  }
}
process.exit(failed ? 1 : 0);
