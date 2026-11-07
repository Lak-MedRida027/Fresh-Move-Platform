/**
 * Scheduled jobs (Cloudflare Cron Triggers, see wrangler.jsonc):
 *  - every 15 minutes: expire pending holds
 *  - daily: retention anonymisation + rate-limit cleanup, and a keep-alive call
 *    so the free Supabase project never pauses for inactivity.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export const CRON_EVERY_15_MIN = '*/15 * * * *';
export const CRON_DAILY = '0 3 * * *';

export interface JobEnv {
  supabaseUrl: string;
  secretKey: string;
}

export type JobResult = Record<string, number | string>;

export async function runJobs(which: 'frequent' | 'daily', env: JobEnv): Promise<JobResult> {
  const db = createClient<Database>(env.supabaseUrl, env.secretKey, { auth: { persistSession: false } });
  const result: JobResult = {};
  if (which === 'frequent') {
    const { data, error } = await db.rpc('expire_holds');
    if (error) throw new Error(`expire_holds: ${error.message}`);
    result.expired = data;
  } else {
    const anonymised = await db.rpc('anonymise_old_reservations');
    if (anonymised.error) throw new Error(`anonymise_old_reservations: ${anonymised.error.message}`);
    result.anonymised = anonymised.data;
    const alive = await db.rpc('keep_alive');
    if (alive.error) throw new Error(`keep_alive: ${alive.error.message}`);
    result.keepAlive = String(alive.data);
  }
  return result;
}

export function jobForCron(cron: string): 'frequent' | 'daily' {
  return cron === CRON_EVERY_15_MIN ? 'frequent' : 'daily';
}
