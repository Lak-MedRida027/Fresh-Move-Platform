-- Fresh Move v2: Row Level Security, grants, function privileges, storage.
-- Deny by default. anon/authenticated may only READ published trips and their
-- images. Everything else needs is_admin() (admin_users row + MFA session).
-- Public writes happen only through SECURITY DEFINER functions that the server
-- calls with the secret key (service_role).

-- ---------------------------------------------------------------------------
-- RLS on every table
-- ---------------------------------------------------------------------------
alter table public.settings enable row level security;
alter table public.members enable row level security;
alter table public.trips enable row level security;
alter table public.trip_images enable row level security;
alter table public.reservations enable row level security;
alter table public.admin_users enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges (checked before RLS). Start from nothing, grant the minimum.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.trips, public.trip_images to anon, authenticated;

grant insert, update, delete on public.trips, public.trip_images to authenticated;
grant select, insert, update, delete on public.members to authenticated;
-- Reservations: status changes only through the admin_* functions (capacity checks).
grant select on public.reservations to authenticated;
grant update (admin_note, payment_method, amount_paid_da) on public.reservations to authenticated;
grant select, insert, update, delete on public.admin_users to authenticated;
grant select on public.audit_log to authenticated;
grant select, update (max_pending_per_person, retention_months, max_gallery_images,
  default_hold_hours, min_age, max_age) on public.settings to authenticated;
-- rate_limits: no direct access for anyone but service_role.

-- New tables in the future don't get automatic grants.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Trips: public sees open / closed / completed; admins see everything.
create policy trips_public_read on public.trips
  for select to anon, authenticated
  using (status in ('open', 'closed', 'completed') or (select public.is_admin()));
create policy trips_admin_insert on public.trips
  for insert to authenticated with check ((select public.is_admin()));
create policy trips_admin_update on public.trips
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy trips_owner_delete on public.trips
  for delete to authenticated using ((select public.is_owner()));

create policy trip_images_public_read on public.trip_images
  for select to anon, authenticated
  using (
    exists (select 1 from public.trips t
            where t.id = trip_id and t.status in ('open', 'closed', 'completed'))
    or (select public.is_admin())
  );
create policy trip_images_admin_insert on public.trip_images
  for insert to authenticated with check ((select public.is_admin()));
create policy trip_images_admin_update on public.trip_images
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy trip_images_admin_delete on public.trip_images
  for delete to authenticated using ((select public.is_admin()));

-- Members: admins read/write; only the owner deletes (privacy requests).
create policy members_admin_read on public.members
  for select to authenticated using ((select public.is_admin()));
create policy members_admin_insert on public.members
  for insert to authenticated with check ((select public.is_admin()));
create policy members_admin_update on public.members
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy members_owner_delete on public.members
  for delete to authenticated using ((select public.is_owner()));

create policy reservations_admin_read on public.reservations
  for select to authenticated using ((select public.is_admin()));
create policy reservations_admin_update on public.reservations
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Admin users: admins see the team; only the owner manages it.
create policy admin_users_admin_read on public.admin_users
  for select to authenticated using ((select public.is_admin()));
create policy admin_users_owner_insert on public.admin_users
  for insert to authenticated with check ((select public.is_owner()));
create policy admin_users_owner_update on public.admin_users
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy admin_users_owner_delete on public.admin_users
  for delete to authenticated using ((select public.is_owner()));

-- Audit log: owner reads; nobody writes directly (triggers / definer functions only).
create policy audit_log_owner_read on public.audit_log
  for select to authenticated using ((select public.is_owner()));

create policy settings_admin_read on public.settings
  for select to authenticated using ((select public.is_admin()));
create policy settings_owner_update on public.settings
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- rate_limits: RLS on, no policies → no access except service_role (bypasses RLS).

-- ---------------------------------------------------------------------------
-- Function privileges. Postgres grants EXECUTE to PUBLIC by default; remove it
-- everywhere, then grant exactly what each role needs.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- Used inside RLS policies (must be callable by the querying role).
grant execute on function public.is_admin(), public.is_owner(), public.admin_role()
  to anon, authenticated;
grant execute on function public.is_admin_pending_mfa() to authenticated;

-- Public, non-personal counts.
grant execute on function public.trip_public_stats(uuid[]) to anon, authenticated;

-- Admin actions (each checks is_admin()/is_owner() itself).
grant execute on function
  public.admin_confirm(uuid, text, integer, boolean),
  public.admin_cancel(uuid, text),
  public.admin_promote(uuid, uuid),
  public.admin_move_to_waitlist(uuid),
  public.admin_extend_hold(uuid, integer),
  public.admin_add_manual_reservation(uuid, text, text, text, integer, boolean, text),
  public.log_export(text, text, integer),
  public.admin_storage_usage()
  to authenticated;

-- Server-only (secret key): public form endpoints, rate limiter and jobs.
grant execute on function
  public.reserve_seat(uuid, text, text, text, integer, boolean),
  public.join_member(text, text, text, integer, boolean),
  public.reservation_status(text, text),
  public.hit_rate_limit(text, integer, integer),
  public.expire_holds(),
  public.anonymise_old_reservations(),
  public.keep_alive()
  to service_role;

grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;

-- ---------------------------------------------------------------------------
-- Storage: bucket trip-images. Public read (by URL); only admins write.
-- The browser converts every photo to WebP before upload.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-images', 'trip-images', true, 15728640, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy trip_images_storage_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trip-images' and (select public.is_admin()));
create policy trip_images_storage_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'trip-images' and (select public.is_admin()))
  with check (bucket_id = 'trip-images' and (select public.is_admin()));
create policy trip_images_storage_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'trip-images' and (select public.is_admin()));
-- Admins may list objects (needed for replace/delete); the public never lists.
create policy trip_images_storage_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'trip-images' and (select public.is_admin()));
