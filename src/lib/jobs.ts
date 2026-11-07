/**
 * Scheduled jobs (Cloudflare Cron Triggers, see wrangler.jsonc), also runnable
 * by hand with POST /api/cron/<job> and the CRON_SECRET:
 *  - frequent (every 15 minutes): expire pending holds.
 *  - daily (03:00 UTC): retention (bookings and audit log), orphan photo files,
 *    and a keep-alive call so the free Supabase project never pauses.
 *
 * Each step runs even if an earlier one failed; the run (start, end, result,
 * errors) is recorded in job_runs and shown on the admin overview.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export const CRON_EVERY_15_MIN = '*/15 * * * *';
export const CRON_DAILY = '0 3 * * *';
export const JOBS = ['frequent', 'daily'] as const;
export type Job = (typeof JOBS)[number];

export interface JobEnv {
  supabaseUrl: string;
  secretKey: string;
}

export type JobResult = Record<string, number | string>;

export class JobError extends Error {
  constructor(
    readonly errors: string[],
    readonly result: JobResult,
  ) {
    super(errors.join('; '));
  }
}

type Db = SupabaseClient<Database>;

const BUCKET = 'trip-images';
const ORPHAN_PATH = /^trips\/[0-9a-f-]{36}\/[0-9a-f-]{36}-(sm|md|lg)\.webp$/;

/**
 * Removes photo files no trip_images row points to (older than a day, so
 * uploads in progress are safe). Refuses to run if most files look orphaned:
 * that would mean a bug, not leftovers.
 */
export async function sweepOrphans(db: Pick<Db, 'rpc' | 'storage'>, batchSize = 100): Promise<JobResult> {
  const { data, error } = await db.rpc('orphan_image_objects', { p_min_age: '1 day', p_limit: 1000 });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const total = Number(rows[0]?.total_objects ?? 0);
  const names = rows.map((r) => r.name).filter((n) => ORPHAN_PATH.test(n));
  if (names.length > 20 && names.length > total / 2) {
    throw new Error(`refusing to remove ${names.length} of ${total} files`);
  }
  let removed = 0;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const res = await db.storage.from(BUCKET).remove(batch);
    if (res.error) throw new Error(res.error.message);
    removed += batch.length;
  }
  return { orphans_removed: removed };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runJobs(which: Job, env: JobEnv, client?: Db): Promise<JobResult> {
  const db = client ?? createClient<Database>(env.supabaseUrl, env.secretKey, { auth: { persistSession: false } });
  const startedAt = new Date().toISOString();
  await db.from('job_runs').upsert({ job: which, started_at: startedAt, finished_at: null, ok: null, error: null, result: {} });

  const result: JobResult = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<JobResult>) => {
    try {
      Object.assign(result, await fn());
    } catch (e) {
      errors.push(`${name}: ${message(e)}`);
    }
  };

  if (which === 'frequent') {
    await step('expire_holds', async () => {
      const { data, error } = await db.rpc('expire_holds');
      if (error) throw new Error(error.message);
      return { expired: data };
    });
  } else {
    await step('retention', async () => {
      const { data, error } = await db.rpc('apply_retention');
      if (error) throw new Error(error.message);
      return data as JobResult;
    });
    await step('orphans', () => sweepOrphans(db));
    await step('keep_alive', async () => {
      const { data, error } = await db.rpc('keep_alive');
      if (error) throw new Error(error.message);
      return { keep_alive: String(data) };
    });
  }

  await db.from('job_runs').upsert({
    job: which,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok: errors.length === 0,
    result,
    error: errors.length ? errors.join('; ').slice(0, 2000) : null,
  });
  if (errors.length) throw new JobError(errors, result);
  return result;
}

export function jobForCron(cron: string): Job {
  return cron === CRON_EVERY_15_MIN ? 'frequent' : 'daily';
}

/**
 * Checks "Authorization: Bearer <CRON_SECRET>" without leaking timing: both
 * sides are hashed, then compared byte by byte. A missing or short secret
 * (under 32 characters) means manual runs are switched off.
 */
export async function cronAuthorized(header: string | null, secret: string | undefined): Promise<boolean> {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(header.slice(7))),
    crypto.subtle.digest('SHA-256', enc.encode(secret)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
