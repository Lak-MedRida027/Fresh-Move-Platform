import type { APIRoute } from 'astro';
import { adminPath } from '../../../lib/admin/paths';
import { formLocale, notAllowed, readForm, redirect, str } from '../../../lib/admin/forms';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await readForm(context);
  const locale = formLocale(form);
  const pending = context.locals.pendingMfa;
  if (!pending) return redirect(adminPath(locale, '/'));
  const factorId = str(form, 'factorId');
  const code = str(form, 'code');
  const retry = `${adminPath(locale, '/mfa/')}?error=mfa_code`;
  if (!factorId || !/^\d{6}$/.test(code)) return redirect(retry);
  const { error } = await pending.supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return redirect(retry);
  return redirect(adminPath(locale, '/'));
};

export const ALL: APIRoute = () => notAllowed();
