// Runs a command with the local Supabase stack's URL and keys in the environment.
// The keys come from `supabase status` at runtime (they're the stack's local
// development keys) so nothing secret is committed.
//   node scripts/with-local-supabase.mjs <command> [args…]
import { execFileSync, spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let status;
try {
  status = JSON.parse(
    execFileSync(npx, ['supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    }),
  );
} catch {
  console.error('Local Supabase is not running. Start it with: npm run db:start');
  process.exit(1);
}

const env = {
  ...process.env,
  SUPABASE_TEST_URL: status.API_URL,
  SUPABASE_TEST_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_TEST_SECRET_KEY: status.SECRET_KEY,
  SUPABASE_TEST_DB_URL: status.DB_URL,
};
// `supabase db reset` restarts Postgres once more right after it returns. Wait
// until the API answers three times in a row so tests never start mid-restart.
async function waitForStableApi() {
  let ok = 0;
  for (let i = 0; i < 120 && ok < 3; i++) {
    try {
      const res = await fetch(`${status.API_URL}/rest/v1/rpc/keep_alive`, {
        method: 'POST',
        headers: { apikey: status.SECRET_KEY, 'content-type': 'application/json' },
        body: '{}',
      });
      ok = res.ok ? ok + 1 : 0;
    } catch {
      ok = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (ok < 3) {
    console.error('Local Supabase API did not become stable within 60 s.');
    process.exit(1);
  }
}
await waitForStableApi();

const [cmd, ...args] = process.argv.slice(2);
const res = spawnSync(cmd, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(res.status ?? 1);
