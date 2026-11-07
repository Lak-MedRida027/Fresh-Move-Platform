/** Member edits (admins) and deletion (owner only, for privacy requests). */
import type { APIRoute } from 'astro';
import { backTo, dbErrorCode, fail, formLocale, intOrNull, notAllowed, ok, readForm, redirect, str } from '../../../lib/admin/forms';
import { adminPath, withFlash } from '../../../lib/admin/paths';
import { cleanName, normalizePhone, validateAge, validateName, validateWilaya } from '../../../lib/membership';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const admin = context.locals.admin;
  const form = await readForm(context);
  const back = backTo(form, '/members/');
  if (!admin) return fail(back, 'forbidden');
  const sb = admin.supabase;
  const id = str(form, 'id');
  const action = str(form, 'action');

  if (action === 'save') {
    const phone = normalizePhone(str(form, 'phone'));
    const age = intOrNull(form, 'age');
    if (validateName(str(form, 'full_name')) || !phone || validateWilaya(str(form, 'wilaya')) || validateAge(age ?? '')) {
      return fail(back, 'invalid_input');
    }
    const { error } = await sb
      .from('members')
      .update({
        full_name: cleanName(str(form, 'full_name')),
        phone,
        wilaya_code: str(form, 'wilaya'),
        age: age!,
        notes: str(form, 'notes').slice(0, 2000) || null,
      })
      .eq('id', id);
    if (error) return fail(back, error.code === '23505' ? 'invalid_input' : dbErrorCode(error));
    return ok(back, 'saved');
  }

  if (action === 'delete') {
    if (admin.role !== 'owner') return fail(back, 'owner_only');
    // Reservations keep the trip history (member_id → null, see DATA_MODEL.md).
    const { data, error } = await sb.from('members').delete().eq('id', id).select('id');
    if (error) return fail(back, dbErrorCode(error));
    if (!data?.length) return fail(back, 'forbidden');
    return redirect(withFlash(adminPath(formLocale(form), '/members/'), 'ok', 'deleted'));
  }
  return fail(back, 'invalid_input');
};

export const ALL: APIRoute = () => notAllowed();
