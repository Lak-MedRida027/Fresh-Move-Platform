/**
 * Real dependencies for the public form endpoints on Cloudflare: secrets and
 * bindings come from the Worker env (`cloudflare:workers`).
 */
import { env } from 'cloudflare:workers';
import type { GuardDeps } from './form-guard';
import { verifyTurnstileToken } from './form-guard';
import { supabaseService } from './supabase/service';

export function serviceClient() {
  return supabaseService(env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Strict, global limiter in the database. Fails open only if the DB call itself fails. */
export async function dbLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await serviceClient().rpc('hit_rate_limit', {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('rate limit check failed', error.code);
    return true;
  }
  return data === true;
}

export function guardDeps(): GuardDeps {
  return {
    now: () => Date.now(),
    limitIp: async (key) => (await env.RL_FORMS.limit({ key })).success,
    verifyTurnstile: (token, ip) => verifyTurnstileToken(env.TURNSTILE_SECRET_KEY, token, ip),
    log: (message, detail) => console.warn(message, detail ?? ''),
  };
}
