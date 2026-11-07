// Encrypted backup of the database (and optionally the trip photos).
//
//   node scripts/backup.mjs --out <dir> [--db-url <postgres url>] [--recipient age1…] [--photos <supabase url>]
//
// Environment fallbacks: BACKUP_DB_URL, BACKUP_AGE_RECIPIENT, BACKUP_PHOTOS_URL.
// Without a database URL it backs up the LOCAL stack (for the restore test).
//
// The output folder only ever contains encrypted files (*.age, readable only
// with the private key) and manifest.json (date, migration versions, row
// counts, file hashes: no personal data). Plain dumps live in a temporary
// folder that is deleted at the end, even on failure.
//
// See docs/BACKUP_RESTORE.md.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { COUNTED, copyRows, countCopyRows, DATA_EXCLUDE, encryptFile, migrationVersions, parseArgs, run, supabase } from './lib/backup.mjs';

const args = parseArgs(process.argv.slice(2));
const out = args.out;
const dbUrl = args['db-url'] ?? process.env.BACKUP_DB_URL ?? '';
const recipient = (args.recipient ?? process.env.BACKUP_AGE_RECIPIENT ?? '').trim();
const photosUrl = (args.photos ?? process.env.BACKUP_PHOTOS_URL ?? '').replace(/\/+$/, '');

if (!out) throw new Error('--out <dir> is required');
if (!/^age1[0-9a-z]{20,}$/.test(recipient)) throw new Error('an age public key (age1…) is required: --recipient or BACKUP_AGE_RECIPIENT');

const target = dbUrl ? [`--remote=${dbUrl}`] : [];
const tmp = await mkdtemp(join(tmpdir(), 'fm-backup-'));
const started = Date.now();
const log = (m) => console.log(`[backup] ${m}`);

try {
  await mkdir(out, { recursive: true });
  log(`dumping ${dbUrl ? 'the remote database' : 'the local database'}`);
  await supabase(['db', 'dump', ...target, '--role-only', '-f', join(tmp, 'roles.sql')]);
  await supabase(['db', 'dump', ...target, '-f', join(tmp, 'schema.sql')]);
  await supabase(['db', 'dump', ...target, '--data-only', '--use-copy', ...DATA_EXCLUDE.flatMap((t) => ['-x', t]), '-f', join(tmp, 'data.sql')]);
  await supabase(['db', 'dump', ...target, '--data-only', '--use-copy', '-s', 'supabase_migrations', '-f', join(tmp, 'migrations.sql')]);

  const data = await readFile(join(tmp, 'data.sql'), 'utf8');
  const counts = countCopyRows(data);
  const versions = migrationVersions(await readFile(join(tmp, 'migrations.sql'), 'utf8'));
  if (!versions.length) throw new Error('no migration history found: is this the right database?');
  if (!('public.trips' in counts)) throw new Error('the data dump has no trips table: refusing to write an empty backup');
  for (const t of DATA_EXCLUDE) if (t in counts) throw new Error(`${t} should have been excluded`);

  const files = ['roles.sql', 'schema.sql', 'data.sql', 'migrations.sql'];
  let photos = null;
  if (photosUrl) {
    // Photo files from storage (public bucket, so no key is needed), packed in a tar.
    const names = copyRows(data, 'storage.objects')
      .filter((o) => o.bucket_id === 'trip-images' && /^trips\/[0-9a-f-]{36}\/[0-9a-f-]{36}-(sm|md|lg)\.webp$/.test(o.name))
      .map((o) => o.name);
    log(`downloading ${names.length} photo files`);
    let bytes = 0;
    let missing = 0;
    const queue = [...names];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let name = queue.shift(); name; name = queue.shift()) {
          const res = await fetch(`${photosUrl}/storage/v1/object/public/trip-images/${name}`);
          if (!res.ok) {
            missing++;
            continue;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          const dest = join(tmp, 'photos', name);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, buf);
          bytes += buf.length;
        }
      }),
    );
    if (names.length - missing > 0) {
      // Relative paths: GNU tar reads 'C:' in an absolute Windows path as a remote host.
      await run('tar', ['-cf', 'photos.tar', '-C', 'photos', 'trips'], { cwd: tmp });
      files.push('photos.tar');
    }
    photos = { files: names.length - missing, missing, bytes };
  }

  const manifest = {
    format: 1,
    created_at: new Date().toISOString(),
    source: dbUrl ? 'remote' : 'local',
    migrations: { count: versions.length, latest: versions.at(-1) },
    counts: Object.fromEntries(COUNTED.map((t) => [t, counts[t] ?? 0])),
    photos,
    files: {},
  };
  for (const f of files) {
    log(`encrypting ${f} (${((await stat(join(tmp, f))).size / 1024).toFixed(0)} KB)`);
    manifest.files[`${f}.age`] = await encryptFile(join(tmp, f), join(out, `${f}.age`), recipient);
  }
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s: ${Object.keys(manifest.files).join(', ')}, manifest.json`);
  log(`rows: ${Object.entries(manifest.counts).map(([t, n]) => `${t} ${n}`).join(', ')}`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
