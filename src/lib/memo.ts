/**
 * Tiny per-isolate cache for Supabase reads. On workers.dev (no zone) the edge
 * cache can't help, so a warm isolate reuses results for `ttlMs`. Admin writes
 * appear within that time (and immediately where the edge cache is purged).
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: now, value });
  // Don't keep failures: the next request retries.
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  if (store.size > 200) store.delete(store.keys().next().value as string);
  return value;
}

export function clearMemo(): void {
  store.clear();
}
