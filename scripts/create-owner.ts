/**
 * Creates the first OWNER admin. Run once per project.
 *
 * Production (an invitation email is sent; the owner chooses their password
 * from that email, then sets up two-step verification on first sign-in):
 *   SEED_SUPABASE_URL=https://xxxx.supabase.co SEED_SUPABASE_SECRET_KEY=sb_secret_… \
 *     node scripts/create-owner.ts owner@example.com --production
 *
 * Local stack (dev only, sets a password directly):
 *   node scripts/with-local-supabase.mjs node scripts/create-owner.ts you@example.test --password 'something long'
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SEED_SUPABASE_URL ?? process.env.SUPABASE_TEST_URL;
const key = process.env.SEED_SUPABASE_SECRET_KEY ?? process.env.SUPABASE_TEST_SECRET_KEY;
const [email, ...rest] = process.argv.slice(2);
if (!url || !key) throw new Error('Set SEED_SUPABASE_URL and SEED_SUPABASE_SECRET_KEY (or run via with-local-supabase).');
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: create-owner.ts <email> [--password …] [--production]');
const host = new URL(url).hostname;
const local = host === '127.0.0.1' || host === 'localhost';
if (!local && !rest.includes('--production')) throw new Error(`${host} is not local. Pass --production on purpose.`);
const pwIndex = rest.indexOf('--password');
const password = pwIndex >= 0 ? rest[pwIndex + 1] : undefined;
if (password && !local) throw new Error('--password is for the local stack only; production owners set it from the invitation email.');

const db = createClient(url, key, { auth: { persistSession: false } });
let userId: string;
if (password) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
} else {
  const { data, error } = await db.auth.admin.inviteUserByEmail(email);
  if (error) throw error;
  userId = data.user.id;
}
const { error } = await db.from('admin_users').upsert({ user_id: userId, role: 'owner', display_name: email });
if (error) throw error;
console.log(`owner ${email} ready on ${host}${password ? '' : ' (invitation email sent)'}`);
