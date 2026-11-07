/**
 * Owner only: invite / change role / remove admins. The invitation email is
 * sent with the secret key (Auth admin API) AFTER checking the caller is the
 * owner; the admin_users row is written with the owner's own session so it's
 * RLS-checked and audited.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { backTo, dbErrorCode, fail, notAllowed, ok, readForm, str } from '../../../lib/admin/forms';
import { supabaseService } from '../../../lib/supabase/service';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const admin = context.locals.admin;
  const form = await readForm(context);
  const back = backTo(form, '/admins/');
  if (!admin || admin.role !== 'owner') return fail(back, 'owner_only');
  const sb = admin.supabase;
  const action = str(form, 'action');
  const role = str(form, 'role') === 'owner' ? 'owner' : 'organizer';

  if (action === 'invite') {
    const email = str(form, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail(back, 'invalid_input');
    const service = supabaseService(env.SUPABASE_SERVICE_ROLE_KEY);
    const redirectTo = new URL('/admin/login/', context.url).href;
    const { data, error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) {
      console.warn('invite failed', error?.status);
      return fail(back, 'invite');
    }
    const { error: insErr } = await sb
      .from('admin_users')
      .insert({ user_id: data.user.id, role, display_name: str(form, 'display_name').slice(0, 80) || email });
    if (insErr) return fail(back, dbErrorCode(insErr));
    return ok(back, 'invited');
  }

  const userId = str(form, 'user_id');
  if (action === 'role') {
    const { error } = await sb.from('admin_users').update({ role }).eq('user_id', userId);
    if (error) return fail(back, dbErrorCode(error));
    return ok(back, 'saved');
  }
  if (action === 'remove') {
    if (userId === admin.userId) return fail(back, 'last_owner');
    const { error } = await sb.from('admin_users').delete().eq('user_id', userId);
    if (error) return fail(back, dbErrorCode(error));
    return ok(back, 'deleted');
  }
  return fail(back, 'invalid_input');
};

export const ALL: APIRoute = () => notAllowed();
