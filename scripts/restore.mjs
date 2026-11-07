// Restores an encrypted backup made by scripts/backup.mjs.
//
//   node scripts/restore.mjs --in <backup dir> --identity <key file> --yes
//        [--db-url <postgres url>] [--photos-url <https://<ref>.supabase.co>] [--no-photos]
//
// Without --db-url it restores into the LOCAL stack. For a hosted project the
// service key for the photo upload comes from SUPABASE_SERVICE_ROLE_KEY.
//
// The target must already have the same migrations applied (supabase db push)
// and no data yet: the script checks both before it writes anything, loads all
// the data in one transaction (all or nothing), uploads the photos, then
// compares row counts with the backup's manifest. See docs/BACKUP_RESTORE.md.
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { COUNTED, decryptFile, isLocalUrl, LOCAL_DB_CONTAINER, migrationVersions, parseArgs, readIdentity, run, sha256File, supabase } from './lib/backup.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = args.in;
const dbUrl = args['db-url'] ?? '';
const log = (m) => console.log(`[restore] ${m}`);
if (!dir || !args.identity) throw new Error('usage: --in <backup dir> --identity <key file> --yes [--db-url …]');
if (args.yes !== true) throw new Error('add --yes to confirm (the target must be empty; nothing is overwritten)');

/** psql against the target: the local stack's container, a local psql, or psql in Docker. */
function psqlCommand() {
  const common = ['-v', 'ON_ERROR_STOP=1', '-X', '-q'];
  if (!dbUrl) return ['docker', ['exec', '-i', LOCAL_DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...common]];
  const hasPsql = spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0;
  if (hasPsql) return ['psql', [dbUrl, ...common]];
  const net = isLocalUrl(dbUrl) ? ['--network', 'host'] : [];
  return ['docker', ['run', '--rm', '-i', ...net, 'postgres:17-alpine', 'psql', dbUrl, ...common]];
}
const [psqlCmd, psqlArgs] = psqlCommand();
const query = async (sql) => (await run(psqlCmd, [...psqlArgs, '-At'], { input: sql })).trim();

const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
if (manifest.format !== 1) throw new Error(`unknown backup format ${manifest.format}`);
log(`backup from ${manifest.created_at} (${manifest.source}), latest migration ${manifest.migrations.latest}`);

for (const [file, meta] of Object.entries(manifest.files)) {
  if ((await sha256File(join(dir, file))) !== meta.sha256) throw new Error(`${file} doesn't match the manifest (damaged or changed)`);
}
log('file hashes match the manifest');

const identity = await readIdentity(args.identity);
const tmp = await mkdtemp(join(tmpdir(), 'fm-restore-'));
try {
  for (const f of ['data.sql', 'migrations.sql', ...(manifest.files['photos.tar.age'] ? ['photos.tar'] : [])]) {
    await decryptFile(join(dir, `${f}.age`), join(tmp, f), identity);
  }
  log('decrypted');

  // 1. Same schema version, empty target.
  const wanted = migrationVersions(await readFile(join(tmp, 'migrations.sql'), 'utf8'));
  const have = (await query('select version from supabase_migrations.schema_migrations order by version;')).split('\n').filter(Boolean);
  if (wanted.join() !== have.join()) {
    throw new Error(
      `the target's migrations don't match the backup.\n  backup: ${wanted.length} up to ${wanted.at(-1)}\n  target: ${have.length} up to ${have.at(-1) ?? 'none'}\n` +
        `Check out the commit whose supabase/migrations end at ${wanted.at(-1)} and run "supabase db push" on the target first.`,
    );
  }
  const existing = Number(await query('select (select count(*) from public.trips) + (select count(*) from public.members) + (select count(*) from public.reservations) + (select count(*) from auth.users);'));
  if (existing !== 0) throw new Error(`the target already has data (${existing} rows in trips/members/reservations/users): restore only into an empty project`);
  log(`target is empty and at migration ${have.at(-1)}`);

  // 2. All data in one transaction. Triggers are off while loading
  //    (session_replication_role = replica), so nothing is audited twice and
  //    foreign keys between tables can load in any order.
  //    Only our data is loaded: public, auth and storage.objects. Supabase's
  //    other storage tables (vectors, analytics, multipart uploads…) belong to
  //    the platform and can't be written by the postgres role; they must be
  //    empty in the backup, or the restore stops here.
  const ours = (table) => /^"(public|auth)"\./.test(table) || table === '"storage"."objects"';
  async function* sql() {
    yield 'SET session_replication_role = replica;\n';
    yield '-- The migrations created the settings row; the backup has the real one.\nDELETE FROM public.settings;\n';
    let skipping = null;
    for await (const line of createInterface({ input: createReadStream(join(tmp, 'data.sql')), crlfDelay: Infinity })) {
      if (skipping) {
        if (line === '\\.') skipping = null;
        else throw new Error(`the backup has rows in ${skipping}, which this script doesn't restore`);
        continue;
      }
      const copy = /^COPY ("[^"]+"\."[^"]+") /.exec(line);
      if (copy && !ours(copy[1])) {
        skipping = copy[1];
        continue;
      }
      yield `${line}\n`;
    }
    yield 'SET session_replication_role = origin;\n';
  }
  await run(psqlCmd, [...psqlArgs, '--single-transaction'], { input: Readable.from(sql()) });
  log('data loaded');

  // 3. Photo files back into storage.
  if (manifest.files['photos.tar.age'] && args['no-photos'] !== true) {
    let url = args['photos-url'];
    let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!dbUrl) {
      const status = JSON.parse(await supabase(['status', '-o', 'json']));
      url = status.API_URL;
      key = status.SECRET_KEY;
    }
    if (!url || !key) throw new Error('photos: pass --photos-url and set SUPABASE_SERVICE_ROLE_KEY (or --no-photos)');
    await run('tar', ['-xf', 'photos.tar'], { cwd: tmp });
    const files = [];
    const walk = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(d, e.name));
        else files.push(relative(tmp, join(d, e.name)).split(sep).join('/'));
      }
    };
    await walk(join(tmp, 'trips'));
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const queue = [...files];
    let failed = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let name = queue.shift(); name; name = queue.shift()) {
          const body = await readFile(join(tmp, name));
          const { error } = await sb.storage.from('trip-images').upload(name, body, { contentType: 'image/webp', cacheControl: '31536000', upsert: true });
          if (error) failed++;
        }
      }),
    );
    if (failed) throw new Error(`${failed} of ${files.length} photo uploads failed`);
    log(`${files.length} photo files uploaded`);
  }

  // 4. Same row counts as the backup.
  const counts = await query(COUNTED.map((t) => `select '${t}', count(*) from ${t};`).join('\n'));
  let bad = 0;
  for (const line of counts.split('\n')) {
    const [table, n] = line.split('|');
    const expected = manifest.counts[table];
    const ok = Number(n) === expected;
    if (!ok) bad++;
    log(`${ok ? 'ok ' : 'BAD'} ${table}: ${n} (backup ${expected})`);
  }
  if (bad) throw new Error(`${bad} table(s) don't match the backup`);
  // New audit entries must not collide with restored ones (identity sequence restored too).
  const seq = await query('select (select coalesce(max(id), 0) from public.audit_log) <= (select last_value from public.audit_log_id_seq);');
  if (seq !== 't') throw new Error('the audit_log id sequence is behind its rows');
  log('restore complete: every count matches. Admins sign in again (sessions are not backed up).');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
