import { describe, expect, it, vi } from 'vitest';
import { jobHealth } from '../../src/lib/admin/data';
import { CRON_DAILY, CRON_EVERY_15_MIN, cronAuthorized, JobError, jobForCron, runJobs, sweepOrphans } from '../../src/lib/jobs';

const T = '0b7f3c52-6a8e-4c1e-9d2a-3f4b5c6d7e8f';
const file = (i: number, size = 'md') => `trips/${T}/${String(i).padStart(8, '0')}-6a8e-4c1e-9d2a-3f4b5c6d7e8f-${size}.webp`;

/** Just enough of a Supabase client for the jobs: rpc results by name, storage remove, job_runs upserts. */
function fakeDb(rpc: Record<string, { data?: unknown; error?: { message: string } } | (() => never)>) {
  const removed: string[][] = [];
  const runs: Record<string, unknown>[] = [];
  const db = {
    rpc: vi.fn(async (name: string) => {
      const r = rpc[name];
      if (typeof r === 'function') return r();
      return { data: r?.data ?? null, error: r?.error ?? null };
    }),
    storage: { from: () => ({ remove: vi.fn(async (names: string[]) => (removed.push(names), { data: [], error: null })) }) },
    from: () => ({ upsert: vi.fn(async (row: Record<string, unknown>) => (runs.push(row), { error: null })) }),
  };
  return { db: db as never, removed, runs };
}

describe('orphan photo sweep', () => {
  it('removes orphans in batches', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ name: file(i), total_objects: 300 }));
    const { db, removed } = fakeDb({ orphan_image_objects: { data: rows } });
    expect(await sweepOrphans(db, 3)).toEqual({ orphans_removed: 7 });
    expect(removed.map((b) => b.length)).toEqual([3, 3, 1]);
  });

  it('never touches anything outside the photo path pattern', async () => {
    const rows = [{ name: file(1), total_objects: 10 }, { name: 'backups/secret.sql', total_objects: 10 }, { name: `trips/${T}/../../x-md.webp`, total_objects: 10 }];
    const { db, removed } = fakeDb({ orphan_image_objects: { data: rows } });
    expect(await sweepOrphans(db)).toEqual({ orphans_removed: 1 });
    expect(removed.flat()).toEqual([file(1)]);
  });

  it('refuses when most files look orphaned (a bug, not leftovers)', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ name: file(i), total_objects: 40 }));
    const { db, removed } = fakeDb({ orphan_image_objects: { data: rows } });
    await expect(sweepOrphans(db)).rejects.toThrow(/refusing to remove 30 of 40/);
    expect(removed).toEqual([]);
  });

  it('nothing to do', async () => {
    const { db } = fakeDb({ orphan_image_objects: { data: [] } });
    expect(await sweepOrphans(db)).toEqual({ orphans_removed: 0 });
  });
});

describe('runJobs', () => {
  const env = { supabaseUrl: 'http://x', secretKey: 'k' };

  it('frequent: expires holds and records the run', async () => {
    const { db, runs } = fakeDb({ expire_holds: { data: 3 } });
    expect(await runJobs('frequent', env, db)).toEqual({ expired: 3 });
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ job: 'frequent', finished_at: null, ok: null });
    expect(runs[1]).toMatchObject({ job: 'frequent', ok: true, error: null, result: { expired: 3 } });
    expect(runs[1]!.finished_at).toEqual(expect.any(String));
  });

  it('daily: every step runs even if one fails; the failure is recorded and thrown', async () => {
    const { db, runs } = fakeDb({
      apply_retention: { error: { message: 'boom' } },
      orphan_image_objects: { data: [{ name: file(1), total_objects: 100 }] },
      keep_alive: { data: '2026-11-07T03:00:00Z' },
    });
    const err = await runJobs('daily', env, db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobError);
    expect((err as JobError).errors).toEqual(['retention: boom']);
    expect((err as JobError).result).toEqual({ orphans_removed: 1, keep_alive: '2026-11-07T03:00:00Z' });
    expect(runs[1]).toMatchObject({ job: 'daily', ok: false, error: 'retention: boom' });
  });

  it('daily: all good', async () => {
    const { db, runs } = fakeDb({
      apply_retention: { data: { anonymised: 2, audit_redacted: 5, rate_limits_deleted: 9 } },
      orphan_image_objects: { data: [] },
      keep_alive: { data: 'now' },
    });
    expect(await runJobs('daily', env, db)).toEqual({ anonymised: 2, audit_redacted: 5, rate_limits_deleted: 9, orphans_removed: 0, keep_alive: 'now' });
    expect(runs[1]).toMatchObject({ ok: true });
  });

  it('cron expressions map to jobs', () => {
    expect(jobForCron(CRON_EVERY_15_MIN)).toBe('frequent');
    expect(jobForCron(CRON_DAILY)).toBe('daily');
  });
});

describe('manual runs need the cron secret', () => {
  const secret = 'x'.repeat(40);
  it('accepts only the exact bearer secret', async () => {
    expect(await cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(await cronAuthorized(`Bearer ${secret}y`, secret)).toBe(false);
    expect(await cronAuthorized(secret, secret)).toBe(false);
    expect(await cronAuthorized(null, secret)).toBe(false);
    expect(await cronAuthorized('Bearer ', secret)).toBe(false);
  });
  it('a missing or short secret switches manual runs off', async () => {
    expect(await cronAuthorized('Bearer ', '')).toBe(false);
    expect(await cronAuthorized('Bearer short', 'short')).toBe(false);
    expect(await cronAuthorized('Bearer undefined', undefined)).toBe(false);
  });
});

describe('job health on the overview', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const run = (job: 'frequent' | 'daily', finishedMinutesAgo: number | null, ok: boolean | null = true, startedMinutesAgo = finishedMinutesAgo ?? 5) => ({
    job,
    started_at: new Date(now - startedMinutesAgo * 60_000).toISOString(),
    finished_at: finishedMinutesAgo === null ? null : new Date(now - finishedMinutesAgo * 60_000).toISOString(),
    ok,
  });
  it('never run (before the first deploy) is not an alarm', () => {
    expect(jobHealth([], now).map((j) => j.state)).toEqual(['never', 'never']);
  });
  it('ok, late, failed, stuck', () => {
    expect(jobHealth([run('frequent', 10), run('daily', 60 * 20)], now).map((j) => j.state)).toEqual(['ok', 'ok']);
    expect(jobHealth([run('frequent', 90), run('daily', 60 * 40)], now).map((j) => j.state)).toEqual(['late', 'late']);
    expect(jobHealth([run('frequent', 5, false)], now)[0]!.state).toBe('failed');
    expect(jobHealth([run('frequent', null, null, 120)], now)[0]!.state).toBe('late');
    expect(jobHealth([run('frequent', null, null, 2)], now)[0]!.state).toBe('ok');
  });
});
