// Shared helpers for scripts/backup.mjs, scripts/restore.mjs and
// scripts/backup-restore-test.mjs. Nothing here prints data or secrets.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Decrypter, Encrypter } from 'age-encryption';

const require = createRequire(import.meta.url);

/** Data that must not be in a backup: sessions, tokens and other short-lived rows. */
export const DATA_EXCLUDE = [
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.mfa_amr_claims',
  'auth.mfa_challenges',
  'auth.flow_state',
  'auth.one_time_tokens',
  'auth.audit_log_entries',
  'public.rate_limits',
  // Created by the migrations (bucket settings live in git), not data.
  'storage.buckets',
];

/** Tables whose row counts go into the manifest and are checked after a restore. */
export const COUNTED = [
  'public.trips',
  'public.trip_images',
  'public.members',
  'public.reservations',
  'public.admin_users',
  'public.audit_log',
  'public.settings',
  'public.job_runs',
  'auth.users',
  'auth.mfa_factors',
  'storage.objects',
];

export const LOCAL_DB_CONTAINER = 'supabase_db_fresh-move';

/** Runs a command without a shell (arguments are never interpreted). Rejects on a non-zero exit. */
export function run(cmd, args, { input, quiet = false, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      // Error output can contain a connection string: show only its last lines, with any URL removed.
      const tail = err.split('\n').slice(-6).join('\n').replace(/postgres(ql)?:\/\/\S+/g, 'postgresql://…');
      reject(new Error(`${cmd} exited with ${code}${quiet ? '' : `\n${tail}`}`));
    });
    if (input) {
      if (typeof input === 'string' || Buffer.isBuffer(input)) child.stdin.end(input);
      else input.pipe(child.stdin);
    }
  });
}

/** The Supabase CLI from node_modules, run with this Node (no shell, any OS). */
export function supabase(args) {
  const cli = require.resolve('supabase/dist/supabase.js');
  return run(process.execPath, [cli, ...args]);
}

/** Row counts per table from a pg_dump "COPY … FROM stdin" data file. */
export function countCopyRows(sql) {
  const counts = {};
  let table = null;
  for (const line of sql.split('\n')) {
    if (table) {
      if (line === '\\.') table = null;
      else counts[table]++;
      continue;
    }
    const m = /^COPY "([^"]+)"\."([^"]+)" /.exec(line);
    if (m) {
      table = `${m[1]}.${m[2]}`;
      counts[table] = 0;
    }
  }
  return counts;
}

/** Decodes one field of COPY text format (\N is null; backslash escapes). */
function copyField(v) {
  if (v === '\\N') return null;
  return v.replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', '\\': '\\' })[c] ?? c);
}

/** Rows of one table from a COPY data file, as objects. */
export function copyRows(sql, table) {
  const [schema, name] = table.split('.');
  const lines = sql.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`COPY "${schema}"."${name}" (`));
  if (start < 0) return [];
  const cols = /\(([^)]*)\)/.exec(lines[start])[1].split(', ').map((c) => c.replace(/"/g, ''));
  const rows = [];
  for (let i = start + 1; i < lines.length && lines[i] !== '\\.'; i++) {
    const values = lines[i].split('\t').map(copyField);
    rows.push(Object.fromEntries(cols.map((c, j) => [c, values[j]])));
  }
  return rows;
}

/** Applied migration versions from a dump of supabase_migrations. */
export function migrationVersions(sql) {
  return copyRows(sql, 'supabase_migrations.schema_migrations')
    .map((r) => r.version)
    .sort();
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export async function encryptFile(src, dest, recipient) {
  const e = new Encrypter();
  e.addRecipient(recipient);
  const out = await e.encrypt(Readable.toWeb(createReadStream(src)));
  await pipeline(Readable.fromWeb(out), createWriteStream(dest));
  return { bytes: (await stat(dest)).size, sha256: await sha256File(dest) };
}

export async function decryptFile(src, dest, identity) {
  const d = new Decrypter();
  d.addIdentity(identity);
  const out = await d.decrypt(Readable.toWeb(createReadStream(src)));
  await pipeline(Readable.fromWeb(out), createWriteStream(dest));
}

/** Reads an age identity (AGE-SECRET-KEY-…) from a key file, ignoring comments. */
export async function readIdentity(path) {
  const key = (await readFile(path, 'utf8'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-'));
  if (!key) throw new Error(`no AGE-SECRET-KEY-… line in ${path}`);
  return key;
}

/** Simple flag parser: --name value, --flag. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

export function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}
