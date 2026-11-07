import type { APIRoute } from 'astro';
import { adminPath } from '../../../lib/admin/paths';
import { formLocale, notAllowed, readForm, redirect } from '../../../lib/admin/forms';
import { supabaseServer } from '../../../lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await readForm(context);
  const supabase =
    context.locals.admin?.supabase ??
    context.locals.pendingMfa?.supabase ??
    supabaseServer(context.request, context.cookies);
  await supabase.auth.signOut();
  context.cookies.delete('fm_admin_seen', { path: '/' });
  return redirect(adminPath(formLocale(form), '/login/'));
};

export const ALL: APIRoute = () => notAllowed();
