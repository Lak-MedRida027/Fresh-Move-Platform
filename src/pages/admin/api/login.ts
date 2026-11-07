import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { adminPath } from '../../../lib/admin/paths';
import { formLocale, notAllowed, readForm, redirect, str } from '../../../lib/admin/forms';
import { supabaseServer } from '../../../lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await readForm(context);
  const locale = formLocale(form);
  const back = (code: string) => redirect(`${adminPath(locale, '/login/')}?error=${code}`);
  const ip = context.clientAddress ?? 'unknown';
  if (!(await env.RL_LOGIN.limit({ key: `login:${ip}` })).success) return back('rate_limited');

  const email = str(form, 'email').toLowerCase();
  const password = str(form, 'password');
  if (!email || !password || email.length > 200 || password.length > 200) return back('login');

  const supabase = supabaseServer(context.request, context.cookies);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One generic message for every failure (no hint whether the email exists).
  if (error) return back(error.status === 429 ? 'rate_limited' : 'login');
  return redirect(adminPath(locale, '/mfa/'));
};

export const ALL: APIRoute = () => notAllowed();
