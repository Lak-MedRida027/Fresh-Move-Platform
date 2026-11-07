// Backup → wipe → restore round trip on the LOCAL stack (npm run backup:test).
//
//  1. a throwaway age key pair (never written outside a temp folder);
//  2. scripts/backup.mjs of the local database and photos;
//  3. checks the backup folder holds nothing readable without the key;
//  4. supabase db reset --no-seed (local only: migrations, no data);
//  5. scripts/restore.mjs, which checks every row count against the manifest.
//
// Local data ends up exactly as it was (sessions aside: sign in again).
// If it fails half-way: npm run db:reset && npm run db:seed.
import { readdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { spawn } from 'node:child_process';
import { supabase } from './lib/backup.mjs';

/** Runs one of our scripts with its output shown (it prints no data or secrets). */
const node = (args) =>
  new Promise((resolve, reject) =>
    spawn(process.execPath, args, { stdio: 'inherit' }).on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${args[0]} failed (${code})`)))),
  );

const log = (m) => console.log(`[backup:test] ${m}`);
let status;
try {
  status = JSON.parse(await supabase(['status', '-o', 'json']));
} catch {
  console.error('Local Supabase is not running (npm run db:start).');
  process.exit(1);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL)) throw new Error('refusing: not the local stack');

const tmp = await mkdtemp(join(tmpdir(), 'fm-backup-test-'));
try {
  const identity = await generateX25519Identity();
  const keyFile = join(tmp, 'test.key');
  await writeFile(keyFile, `# throwaway key for the restore test\n${identity}\n`);
  const out = join(tmp, 'backup');

  log('1/4 backup');
  await node(['scripts/backup.mjs', '--out', out, '--recipient', await identityToRecipient(identity), '--photos', status.API_URL]);

  log('2/4 the backup folder has only encrypted files and the manifest');
  const files = (await readdir(out)).sort();
  for (const f of files) if (f !== 'manifest.json' && !f.endsWith('.age')) throw new Error(`unexpected plain file ${f}`);
  for (const f of files.filter((x) => x.endsWith('.age'))) {
    const bytes = await readFile(join(out, f));
    if (!bytes.subarray(0, 21).toString('latin1').startsWith('age-encryption.org/v1')) throw new Error(`${f} is not an age file`);
    const text = bytes.toString('latin1');
    for (const marker of ['COPY "public"', 'CREATE TABLE', '+2135', 'RIFF']) {
      if (text.includes(marker)) throw new Error(`${f} contains readable data (${marker})`);
    }
  }
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  if (JSON.stringify(manifest).match(/\+213|@/)) throw new Error('the manifest contains personal data');

  log('3/4 wiping the local database (migrations only, no seed)');
  await supabase(['db', 'reset', '--no-seed']);
  // Postgres restarts once more after reset returns; wait for the API and storage.
  for (let ok = 0, i = 0; ok < 3 && i < 120; i++) {
    const res = await fetch(`${status.API_URL}/storage/v1/bucket/trip-images`, { headers: { apikey: status.SECRET_KEY, Authorization: `Bearer ${status.SECRET_KEY}` } }).catch(() => null);
    ok = res?.ok ? ok + 1 : 0;
    await new Promise((r) => setTimeout(r, 1000));
  }

  log('4/4 restore');
  await node(['scripts/restore.mjs', '--in', out, '--identity', keyFile, '--yes']);
  log(`passed: ${Object.entries(manifest.counts).map(([t, n]) => `${t} ${n}`).join(', ')}; photos ${manifest.photos?.files ?? 0}`);
} catch (e) {
  console.error(`[backup:test] FAILED: ${e instanceof Error ? e.message : e}`);
  console.error('[backup:test] To get local data back: npm run db:reset && npm run db:seed');
  process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
