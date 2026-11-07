/// <reference types="astro/client" />
import type { AdminClient } from './lib/supabase/server';

declare global {
  namespace App {
    interface Locals {
      /** Set by middleware on /admin routes once the session, MFA and role are verified. */
      admin?: {
        supabase: AdminClient;
        userId: string;
        email: string;
        role: 'owner' | 'organizer';
      };
      /** Signed in but MFA not completed yet (only on the MFA page). */
      pendingMfa?: { supabase: AdminClient; userId: string; email: string };
    }
  }
}
export {};
