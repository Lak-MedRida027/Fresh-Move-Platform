/**
 * Trip photos.
 *
 * Upload (JSON, called by the admin page script):
 *   prepare  → a new image id + one signed upload URL per size. The browser
 *              sends the WebP files straight to Supabase Storage, so photo
 *              bytes never pass through the Worker (CPU limit).
 *   register → checks the three files really are in storage (WebP, size)
 *              and adds the trip_images row. On failure the files are removed.
 *   abort    → removes the files of an upload that didn't finish.
 *
 * Per-photo actions (plain form posts): save alt text / kind, set cover,
 * move up / down, delete (row first, then its storage files).
 *
 * Everything runs as the signed-in admin: RLS and storage policies apply.
 */
import type { APIContext, APIRoute } from 'astro';
import { backTo, dbErrorCode, fail, notAllowed, ok, readForm, str } from '../../../lib/admin/forms';
import { purgeTrips } from '../../../lib/admin/purge';
import { imagePaths, MAX_STORED_BYTES, SIZES, UUID_RE, validDimensions, validPlaceholder } from '../../../lib/images/sizes';
import { BUCKET, removeImageFiles } from '../../../lib/admin/storage';
import type { AdminClient } from '../../../lib/supabase/server';

export const prerender = false;

const KINDS = ['poster', 'gallery'] as const;
type Kind = (typeof KINDS)[number];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const jsonError = (error: string, status = 400) => json({ ok: false, error }, status);

interface UploadBody {
  action?: unknown;
  trip_id?: unknown;
  id?: unknown;
  kind?: unknown;
  width?: unknown;
  height?: unknown;
  placeholder?: unknown;
}

async function handleUpload(context: APIContext, sb: AdminClient): Promise<Response> {
  // JSON isn't covered by Astro's form CSRF check: require a same-origin request.
  if (context.request.headers.get('origin') !== context.url.origin) return jsonError('forbidden', 403);
  let body: UploadBody;
  try {
    body = (await context.request.json()) as UploadBody;
  } catch {
    return jsonError('invalid_input');
  }
  const tripId = typeof body.trip_id === 'string' && UUID_RE.test(body.trip_id) ? body.trip_id : null;
  if (!tripId) return jsonError('invalid_input');

  if (body.action === 'prepare') {
    const kind = KINDS.includes(body.kind as Kind) ? (body.kind as Kind) : null;
    if (!kind) return jsonError('invalid_input');
    const { data: trip } = await sb.from('trips').select('id').eq('id', tripId).maybeSingle();
    if (!trip) return jsonError('not_found', 404);
    if (kind === 'gallery') {
      const [{ data: settings }, { count }] = await Promise.all([
        sb.from('settings').select('max_gallery_images').maybeSingle(),
        sb.from('trip_images').select('id', { count: 'exact', head: true }).eq('trip_id', tripId).eq('kind', 'gallery'),
      ]);
      if (settings && (count ?? 0) >= settings.max_gallery_images) return jsonError('too_many_images');
    }
    const id = crypto.randomUUID();
    const paths = imagePaths(tripId, id);
    const uploads: Record<string, string> = {};
    for (const size of SIZES) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(paths[size]);
      if (error || !data) return jsonError('forbidden', 403);
      uploads[size] = data.signedUrl;
    }
    return json({ ok: true, id, uploads });
  }

  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null;
  if (!id) return jsonError('invalid_input');

  if (body.action === 'abort') {
    const { data: row } = await sb.from('trip_images').select('id').eq('id', id).maybeSingle();
    if (row) return jsonError('invalid_status'); // registered photos are deleted with the form action
    await removeImageFiles(sb, tripId, id);
    return json({ ok: true });
  }

  if (body.action === 'register') {
    const kind = KINDS.includes(body.kind as Kind) ? (body.kind as Kind) : null;
    if (!kind || !validDimensions(body.width, body.height) || !validPlaceholder(body.placeholder)) {
      await removeImageFiles(sb, tripId, id);
      return jsonError('invalid_input');
    }
    // Trust what is in storage, not what the browser says it uploaded.
    const { data: objects, error: listError } = await sb.storage.from(BUCKET).list(`trips/${tripId}`, { search: id, limit: 10 });
    const byName = new Map((objects ?? []).map((o) => [o.name, o]));
    let total = 0;
    for (const size of SIZES) {
      const o = byName.get(`${id}-${size}.webp`);
      const meta = (o?.metadata ?? {}) as { size?: number; mimetype?: string };
      if (listError || !o || meta.mimetype !== 'image/webp' || !meta.size || meta.size > MAX_STORED_BYTES) {
        await removeImageFiles(sb, tripId, id);
        return jsonError('upload_incomplete');
      }
      total += meta.size;
    }
    const { data: last } = await sb
      .from('trip_images')
      .select('sort_order')
      .eq('trip_id', tripId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const paths = imagePaths(tripId, id);
    const { error } = await sb.from('trip_images').insert({
      id,
      trip_id: tripId,
      kind,
      path_sm: paths.sm,
      path_md: paths.md,
      path_lg: paths.lg,
      width: body.width as number,
      height: body.height as number,
      placeholder: body.placeholder,
      size_bytes: total,
      sort_order: (last?.sort_order ?? 0) + 1,
    });
    if (error) {
      await removeImageFiles(sb, tripId, id);
      return jsonError(dbErrorCode(error));
    }
    await purgeTrips(context);
    return json({ ok: true, id });
  }

  return jsonError('invalid_input');
}

async function handleForm(context: APIContext, sb: AdminClient): Promise<Response> {
  const form = await readForm(context);
  const back = backTo(form, '/trips/');
  const action = str(form, 'action');
  const id = str(form, 'id');
  if (!UUID_RE.test(id)) return fail(back, 'invalid_input');
  const { data: img } = await sb.from('trip_images').select('id, trip_id, path_sm, path_md, path_lg').eq('id', id).maybeSingle();
  if (!img) return fail(back, 'not_found');

  switch (action) {
    case 'save': {
      const kind = str(form, 'kind') as Kind;
      if (!KINDS.includes(kind)) return fail(back, 'invalid_input');
      const { error } = await sb
        .from('trip_images')
        .update({ alt_ar: str(form, 'alt_ar').slice(0, 300), alt_en: str(form, 'alt_en').slice(0, 300), kind })
        .eq('id', id);
      if (error) return fail(back, dbErrorCode(error));
      await purgeTrips(context);
      return ok(back, 'saved');
    }
    case 'cover': {
      const { error } = await sb.from('trips').update({ cover_image_id: id }).eq('id', img.trip_id);
      if (error) return fail(back, dbErrorCode(error));
      await purgeTrips(context);
      return ok(back, 'cover');
    }
    case 'up':
    case 'down': {
      const { data: rows } = await sb
        .from('trip_images')
        .select('id')
        .eq('trip_id', img.trip_id)
        .order('sort_order')
        .order('created_at');
      const ids = (rows ?? []).map((r) => r.id);
      const i = ids.indexOf(id);
      const j = action === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return ok(back, 'moved');
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      const { error } = await sb.rpc('admin_reorder_images', { p_trip_id: img.trip_id, p_ids: ids });
      if (error) return fail(back, dbErrorCode(error));
      await purgeTrips(context);
      return ok(back, 'moved');
    }
    case 'delete': {
      // Row first: if the database refuses, the files stay with their row.
      const { error } = await sb.from('trip_images').delete().eq('id', id);
      if (error) return fail(back, dbErrorCode(error));
      await removeImageFiles(sb, img.trip_id, img.id);
      await purgeTrips(context);
      return ok(back, 'deleted');
    }
    default:
      return fail(back, 'invalid_input');
  }
}

export const POST: APIRoute = async (context) => {
  const admin = context.locals.admin;
  const isJson = (context.request.headers.get('content-type') ?? '').startsWith('application/json');
  if (!admin) return isJson ? jsonError('forbidden', 403) : fail(backTo(new FormData(), '/trips/'), 'forbidden');
  return isJson ? handleUpload(context, admin.supabase) : handleForm(context, admin.supabase);
};

export const ALL: APIRoute = () => notAllowed();
