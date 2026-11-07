/**
 * Imports the v1 members (Google Sheet → File → Download → Comma-separated values).
 *
 * Dry run (default: reads and checks the file, writes nothing):
 *   node scripts/with-local-supabase.mjs node scripts/import-members.ts members.csv
 * Write to the local stack:   … members.csv --commit
 * Production (after checking the dry run): set SEED_SUPABASE_URL and
 * SEED_SUPABASE_SECRET_KEY, then: node scripts/import-members.ts members.csv --production --commit
 *
 * Existing members (same phone, e.g. people who already joined on the new site)
 * are left exactly as they are. Repeats in the sheet keep the first row.
 * Prints counts only, never names or phones. See docs/DEPLOY.md, step 9.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { mapMembers, parseCsv } from './lib/members-csv.mjs';

const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error('Usage: import-members.ts <members.csv> [--commit] [--production]');
const url = process.env.SEED_SUPABASE_URL ?? process.env.SUPABASE_TEST_URL;
const key = process.env.SEED_SUPABASE_SECRET_KEY ?? process.env.SUPABASE_TEST_SECRET_KEY;
if (!url || !key) throw new Error('Set SEED_SUPABASE_URL and SEED_SUPABASE_SECRET_KEY (or run via with-local-supabase).');
const host = new URL(url).hostname;
const local = host === '127.0.0.1' || host === 'localhost';
if (!local && !flags.includes('--production')) throw new Error(`${host} is not local. Pass --production on purpose.`);
const commit = flags.includes('--commit');

const { members, skipped, rows } = mapMembers(parseCsv(readFileSync(file, 'utf8')));
const db = createClient(url, key, { auth: { persistSession: false } });

// Which phones are already members.
const existing = new Set<string>();
for (let i = 0; i < members.length; i += 200) {
  const { data, error } = await db.from('members').select('phone').in('phone', members.slice(i, i + 200).map((m) => m.phone));
  if (error) throw new Error(error.message);
  for (const r of data ?? []) existing.add(r.phone);
}
const fresh = members.filter((m) => !existing.has(m.phone));

console.log(`${host}: ${rows} rows in the file`);
console.log(`  ${members.length} valid members (${skipped.duplicate} repeats of the same phone left out)`);
const bad = Object.entries(skipped).filter(([k, n]) => k !== 'duplicate' && n > 0);
if (bad.length) console.log(`  skipped as invalid: ${bad.map(([k, n]) => `${n} ${k}`).join(', ')}`);
console.log(`  ${existing.size} already in the database (left unchanged)`);
console.log(`  ${fresh.length} to import`);

// (No process.exit: on Windows it can crash Node while connections are still closing.)
if (!commit) {
  console.log('\nDry run: nothing written. Add --commit to import.');
} else {
  let imported = 0;
  for (let i = 0; i < fresh.length; i += 500) {
    // ignoreDuplicates: someone who joins on the new site during the import keeps their own row.
    const { data, error } = await db.from('members').upsert(fresh.slice(i, i + 500), { onConflict: 'phone', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`batch ${i / 500 + 1}: ${error.message}`);
    imported += data?.length ?? 0;
  }
  console.log(`\nImported ${imported} members (source "import").`);
}
