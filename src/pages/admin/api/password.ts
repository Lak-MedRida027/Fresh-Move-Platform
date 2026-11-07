/**
 * Choose a new password: after an invitation or a reset link, or any time from
 * the admin menu. Someone who already has MFA must pass the code first
 * (Supabase answers insufficient_aal otherwise): they're sent to the MFA page,
 * which brings them back here.
 */
import type { APIRoute } from 'astro';
import { adminPath } from '../../../lib/admin/paths';
import { passwordProblem } from '../../../lib/admin/auth';
import { formLocale, notAllowed, readForm, redirect } from '../../../lib/admin/forms';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await readForm(context);
  const locale = formLocale(form);
  const session = context.locals.admin ?? context.locals.pendingMfa;
  if (!session) return redirect(adminPath(locale, '/login/'));
  const page = adminPath(locale, '/password/');
  const password = String(form.get('password') ?? '');
  const repeat = String(form.get('password_repeat') ?? '');
  const problem = passwordProblem(password, repeat, session.email);
  if (problem) return redirect(`${page}?error=${problem}`);

  const { error } = await session.supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === 'insufficient_aal') return redirect(`${adminPath(locale, '/mfa/')}?next=password`);
    if (error.code === 'same_password') return redirect(`${page}?error=pw_same`);
    if (error.code === 'weak_password') return redirect(`${page}?error=pw_weak`);
    console.warn('password update failed', error.code ?? error.status);
    return redirect(`${page}?error=generic`);
  }
  // A new admin goes on to set up the authenticator app; everyone else back to the dashboard.
  return redirect(context.locals.admin ? `${adminPath(locale, '/')}?ok=password` : adminPath(locale, '/mfa/'));
};

export const ALL: APIRoute = () => notAllowed();
