/**
 * Email links (invitation, password reset) land on /admin/auth/confirm/,
 * which posts here when the person clicks "Continue". Only this POST uses the
 * one-time token, so link scanners that open emails can't spend it.
 * Success: a password-only session, then the password page.
 */
import type { APIRoute } from 'astro';
import { adminPath } from '../../../lib/admin/paths';
import { formLocale, notAllowed, readForm, redirect, str } from '../../../lib/admin/forms';
import { linkType, validTokenHash } from '../../../lib/admin/auth';
import { supabaseServer } from '../../../lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await readForm(context);
  const locale = formLocale(form);
  const type = linkType(str(form, 'type'));
  const tokenHash = str(form, 'token_hash');
  const fail = () => redirect(`${adminPath(locale, '/login/')}?error=link`);
  if (!type || !validTokenHash(tokenHash)) return fail();

  const supabase = supabaseServer(context.request, context.cookies);
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail();
  return redirect(adminPath(locale, '/password/'));
};

export const ALL: APIRoute = () => notAllowed();
