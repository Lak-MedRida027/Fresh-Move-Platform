/**
 * Removing photo files from Supabase Storage (bucket trip-images), as the
 * signed-in admin. Rows are deleted first; if a file removal fails it is
 * logged and the file stays (it no longer appears anywhere on the site).
 */
import { imagePaths } from '../images/sizes';
import type { AdminClient } from '../supabase/server';

export const BUCKET = 'trip-images';

export async function removeImageFiles(sb: AdminClient, tripId: string, imageId: string): Promise<boolean> {
  const { error } = await sb.storage.from(BUCKET).remove(Object.values(imagePaths(tripId, imageId)));
  if (error) console.error('[storage] could not remove photo files', tripId, imageId, error.message);
  return !error;
}

/** Everything under trips/<tripId>/ (after the trip itself was deleted). */
export async function removeTripFiles(sb: AdminClient, tripId: string): Promise<boolean> {
  const folder = `trips/${tripId}`;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await sb.storage.from(BUCKET).list(folder, { limit: 100 });
    if (error) {
      console.error('[storage] could not list trip files', tripId, error.message);
      return false;
    }
    if (!data?.length) return true;
    const { error: rmError } = await sb.storage.from(BUCKET).remove(data.map((o) => `${folder}/${o.name}`));
    if (rmError) {
      console.error('[storage] could not remove trip files', tripId, rmError.message);
      return false;
    }
  }
  return false;
}
