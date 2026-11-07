/** Owner only: update the settings row (RLS: settings_owner_update). */
import type { APIRoute } from 'astro';
import type { Database } from '../../../lib/database.types';
import { backTo, dbErrorCode, fail, intOrNull, notAllowed, ok, readForm } from '../../../lib/admin/forms';

export const prerender = false;

const KEYS = ['max_pending_per_person', 'default_hold_hours', 'retention_months', 'max_gallery_images', 'min_age', 'max_age'] as const;

export const POST: APIRoute = async (context) => {
  const admin = context.locals.admin;
  const form = await readForm(context);
  const back = backTo(form, '/settings/');
  if (!admin || admin.role !== 'owner') return fail(back, 'owner_only');
  const values: Database['public']['Tables']['settings']['Update'] = {};
  for (const k of KEYS) {
    const v = intOrNull(form, k);
    if (v === null) return fail(back, 'invalid_input');
    values[k] = v;
  }
  const { data, error } = await admin.supabase.from('settings').update(values).eq('id', true).select('id');
  if (error) return fail(back, error.code === '23514' ? 'invalid_input' : dbErrorCode(error));
  if (!data?.length) return fail(back, 'forbidden');
  return ok(back, 'saved');
};

export const ALL: APIRoute = () => notAllowed();
