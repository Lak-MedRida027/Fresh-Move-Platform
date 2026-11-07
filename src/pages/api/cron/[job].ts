/**
 * Run a scheduled job by hand: POST /api/cron/frequent or /api/cron/daily with
 * "Authorization: Bearer <CRON_SECRET>". Same code as the cron triggers
 * (src/lib/jobs.ts). Used for checks after a deploy and by the tests.
 * Without a CRON_SECRET of at least 32 characters, every call is refused.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cronAuthorized, JobError, JOBS, runJobs, type Job } from '../../../lib/jobs';
import { serviceClient } from '../../../lib/server-deps';

export const prerender = false;

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

export const POST: APIRoute = async ({ params, request }) => {
  if (!(await cronAuthorized(request.headers.get('authorization'), env.CRON_SECRET))) {
    return json(401, { ok: false, error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
  }
  const job = params.job as Job;
  if (!JOBS.includes(job)) return json(404, { ok: false, error: 'not_found' });
  try {
    const result = await runJobs(job, { supabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL, secretKey: env.SUPABASE_SERVICE_ROLE_KEY }, serviceClient());
    return json(200, { ok: true, job, result });
  } catch (e) {
    if (e instanceof JobError) return json(500, { ok: false, job, result: e.result, errors: e.errors });
    console.error(`cron ${job} failed`, e instanceof Error ? e.message : e);
    return json(500, { ok: false, job, error: 'failed' });
  }
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
