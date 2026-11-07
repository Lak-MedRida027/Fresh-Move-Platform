/**
 * Trip actions from the admin: save (create / update), duplicate, change
 * status, delete. Runs as the admin (RLS); database constraints and triggers
 * re-check dates, capacity vs confirmed seats and alt text before publishing.
 */
import type { APIRoute } from 'astro';
import { backTo, dbErrorCode, fail, formLocale, notAllowed, ok, readForm, redirect, str } from '../../../lib/admin/forms';
import { adminPath, withFlash } from '../../../lib/admin/paths';
import { purgeTrips } from '../../../lib/admin/purge';
import { removeTripFiles } from '../../../lib/admin/storage';
import { parseTripForm, slugify, TRIP_STATUSES } from '../../../lib/admin/trip-form';
import type { AdminClient } from '../../../lib/supabase/server';

export const prerender = false;

async function uniqueSlug(sb: AdminClient, base: string, exceptId?: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 50; i++) {
    let q = sb.from('trips').select('id').eq('slug', slug);
    if (exceptId) q = q.neq('id', exceptId);
    const { data } = await q.maybeSingle();
    if (!data) return slug;
    slug = `${base.slice(0, 74)}-${i}`;
  }
  return `${base.slice(0, 60)}-${Date.now()}`;
}

export const POST: APIRoute = async (context) => {
  const admin = context.locals.admin;
  const form = await readForm(context);
  const locale = formLocale(form);
  const back = backTo(form, '/trips/');
  if (!admin) return fail(back, 'forbidden');
  const sb = admin.supabase;
  const action = str(form, 'action');
  const id = str(form, 'id');

  if (action === 'save') {
    const { values, errors } = parseTripForm(form);
    const first = Object.values(errors)[0];
    if (first) return fail(back, first === 'required' || first === 'invalid' ? 'validation' : first);
    values.slug = await uniqueSlug(sb, values.slug!, id || undefined);
    if (id) {
      const { error } = await sb.from('trips').update(values).eq('id', id);
      if (error) return fail(back, dbErrorCode(error));
      await purgeTrips(context);
      return ok(back, 'saved');
    }
    const { data, error } = await sb.from('trips').insert(values).select('id').single();
    if (error) return fail(back, dbErrorCode(error));
    await purgeTrips(context);
    return redirect(withFlash(adminPath(locale, `/trips/${data.id}/`), 'ok', 'created'));
  }

  if (action === 'duplicate') {
    const { data: src, error } = await sb.from('trips').select('*').eq('id', id).single();
    if (error || !src) return fail(back, 'not_found');
    const { id: _id, created_at: _c, updated_at: _u, cover_image_id: _cover, ...rest } = src;
    const slug = await uniqueSlug(sb, slugify(`${src.slug}-copy`));
    const { data, error: insErr } = await sb
      .from('trips')
      .insert({ ...rest, slug, status: 'draft', featured: false, instagram_post_url: null })
      .select('id')
      .single();
    if (insErr) return fail(back, dbErrorCode(insErr));
    return redirect(withFlash(adminPath(locale, `/trips/${data.id}/`), 'ok', 'duplicated'));
  }

  if (action === 'status') {
    const status = str(form, 'status');
    if (!(TRIP_STATUSES as readonly string[]).includes(status)) return fail(back, 'invalid_input');
    const { error } = await sb.from('trips').update({ status }).eq('id', id);
    if (error) return fail(back, dbErrorCode(error));
    await purgeTrips(context);
    return ok(back, 'status');
  }

  if (action === 'delete') {
    if (admin.role !== 'owner') return fail(back, 'owner_only');
    const { data, error } = await sb.from('trips').delete().eq('id', id).select('id');
    if (error) return fail(back, error.code === '23503' ? 'invalid_status' : dbErrorCode(error));
    if (!data?.length) return fail(back, 'not_found');
    // The rows of its photos went with the trip (cascade); now their files.
    await removeTripFiles(sb, id);
    await purgeTrips(context);
    return redirect(withFlash(adminPath(locale, '/trips/'), 'ok', 'deleted'));
  }

  return fail(back, 'invalid_input');
};

export const ALL: APIRoute = () => notAllowed();
