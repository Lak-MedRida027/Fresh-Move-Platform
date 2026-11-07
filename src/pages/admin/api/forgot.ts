/**
 * "Forgot your password?": sends a reset link if the address belongs to an
 * account (only admins have accounts: sign-ups are off). The answer is always
 * the same, so nobody can find out which addresses are admins. Rate-limited
 * here per IP and by Supabase per address.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { adminPath } from '../../../lib/admin/paths';
import { formLocale, notAllowed, readForm, redirect, str } from '../../../lib/admin/forms';
import { supabaseServer } from '../../../lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await readForm(context);
  const locale = formLocale(form);
  const page = adminPath(locale, '/forgot/');
  const ip = context.clientAddress ?? 'unknown';
  if (!(await env.RL_LOGIN.limit({ key: `forgot:${ip}` })).success) return redirect(`${page}?error=rate_limited`);

  const email = str(form, 'email').toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200) {
    const supabase = supabaseServer(context.request, context.cookies);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) console.warn('password reset email failed', error.status);
  }
  return redirect(`${page}?sent=1`);
};

export const ALL: APIRoute = () => notAllowed();
