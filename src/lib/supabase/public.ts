/**
 * Read-only Supabase client for public pages. Uses the publishable key, so the
 * database's RLS applies (published trips and their images only).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

export type PublicClient = SupabaseClient<Database>;

let client: PublicClient | null = null;

export function supabasePublic(): PublicClient {
  if (!client) {
    const url = import.meta.env.PUBLIC_SUPABASE_URL;
    const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY are not set');
    client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
