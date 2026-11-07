/**
 * Privileged Supabase client (secret key: bypasses RLS). SERVER ONLY: used by
 * the public form endpoints to call specific SQL functions after validation,
 * Turnstile and rate limiting. Never import this from client code or admin pages.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

export type ServiceClient = SupabaseClient<Database>;

let cached: { key: string; client: ServiceClient } | null = null;

export function supabaseService(secretKey: string): ServiceClient {
  if (!secretKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  if (cached?.key !== secretKey) {
    const client = createClient<Database>(import.meta.env.PUBLIC_SUPABASE_URL, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    cached = { key: secretKey, client };
  }
  return cached.client;
}
