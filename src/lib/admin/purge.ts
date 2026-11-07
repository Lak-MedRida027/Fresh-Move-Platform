/** After admin changes: drop cached trip data so public pages update right away. */
import type { APIContext } from 'astro';
import { clearMemo } from '../memo';

export async function purgeTrips(context: APIContext): Promise<void> {
  clearMemo();
  try {
    if (context.cache?.enabled) await context.cache.invalidate({ tags: ['trips'] });
  } catch (error) {
    // Expected in local preview (no edge cache); in production a failure only means
    // public pages update after the 60 s cache instead of immediately.
    console.debug('cache purge skipped', error instanceof Error ? error.message : error);
  }
}
