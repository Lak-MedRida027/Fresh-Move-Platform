-- Fresh Move v2: functions (auth helpers, seat logic, admin actions, jobs, audit).
-- Every SECURITY DEFINER function pins search_path = '' and uses qualified names.
-- Errors are raised with short machine codes in MESSAGE (mapped to friendly,
-- generic text by the server); details never reach the public.

-- ---------------------------------------------------------------------------
-- Auth helpers. Admin access requires a row in admin_users AND an MFA-verified
-- session (aal2), checked here so it holds for direct API calls too.
-- ---------------------------------------------------------------------------
create function public.admin_role() returns text
language sql stable security definer set search_path = '' as $$
  select a.role
  from public.admin_users a
  where a.user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.admin_role() is not null;
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.admin_role() = 'owner', false);
$$;

-- Same check without the MFA requirement: lets the login flow tell an admin
-- "now enter your authenticator code" instead of "not an admin".
create function public.is_admin_pending_mfa() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create function private.new_reservation_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- 32 chars, no 0/O/1/I
  bytes bytea := extensions.gen_random_bytes(5);
  result text := 'FM-';
begin
  for i in 0..4 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

-- Seats held right now: confirmed + pending holds that haven't expired.
-- Correct even if expire_holds() never ran.
create function private.seats_taken(p_trip_id uuid) returns integer
language sql stable set search_path = '' as $$
  select count(*)::integer
  from public.reservations r
  where r.trip_id = p_trip_id
    and (r.status = 'confirmed' or (r.status = 'pending' and r.hold_expires_at > now()));
$$;

create function private.raise_error(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end;
$$;

create function private.require_admin() returns void
language plpgsql set search_path = '' as $$
begin
  if not public.is_admin() then
    perform private.raise_error('forbidden');
  end if;
end;
$$;

create function private.write_audit(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb)
returns void
language sql set search_path = '' as $$
  insert into public.audit_log (actor_user_id, action, entity, entity_id, before, after)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- ---------------------------------------------------------------------------
-- Public counts (no personal data)
-- ---------------------------------------------------------------------------
create function public.trip_public_stats(p_trip_ids uuid[])
returns table (trip_id uuid, capacity integer, seats_left integer)
language sql stable security definer set search_path = '' as $$
  select t.id, t.capacity, greatest(coalesce(t.capacity, 0) - private.seats_taken(t.id), 0)
  from public.trips t
  where t.id = any (p_trip_ids)
    and t.status in ('open', 'closed', 'completed');
$$;

-- ---------------------------------------------------------------------------
-- Core reservation logic (shared by the public and admin entry points)
-- ---------------------------------------------------------------------------
create function private.reserve_core(
  p_trip_id uuid,
  p_full_name text,
  p_phone text,
  p_wilaya_code text,
  p_age integer,
  p_consent boolean,
  p_source text,            -- 'web' | 'admin'
  p_initial_status text default null, -- admin only: 'confirmed' to confirm immediately
  p_note text default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  s public.settings;
  t public.trips;
  v_member_id uuid;
  v_existing public.reservations;
  v_taken integer;
  v_left integer;
  v_status text;
  v_hold timestamptz;
  v_code text;
  v_pending integer;
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_constraint text;
begin
  select * into s from public.settings where id;

  -- Input validation (defence in depth: the server validated already).
  if char_length(v_name) not between 2 and 60
     or coalesce(p_phone, '') !~ '^\+213[567][0-9]{8}$'
     or coalesce(p_wilaya_code, '') !~ '^[0-9]{2}$'
     or p_wilaya_code::int not between 1 and 69
     or p_age is null or p_age not between s.min_age and s.max_age then
    perform private.raise_error('invalid_input');
  end if;
  if p_source = 'web' and p_consent is distinct from true then
    perform private.raise_error('consent_required');
  end if;

  -- 1. Lock the trip: every seat decision for this trip is serialised.
  select * into t from public.trips where id = p_trip_id for update;
  if not found then
    perform private.raise_error('trip_not_found');
  end if;

  -- 2. Bookable?
  if p_source = 'web' then
    if t.status <> 'open' then
      perform private.raise_error('trip_not_open');
    end if;
    if t.registration_deadline is not null and now() > t.registration_deadline then
      perform private.raise_error('registration_closed');
    end if;
  elsif t.status not in ('open', 'closed') then
    perform private.raise_error('trip_not_open');
  end if;
  if t.start_date is null or t.start_date < (now() at time zone 'Africa/Algiers')::date then
    perform private.raise_error('trip_past');
  end if;

  -- 3. Upsert the member by phone. Newer name / wilaya / age replace the old ones;
  --    consent time is kept from the first time it was given.
  insert into public.members (full_name, phone, wilaya_code, age, consent_at, source)
  values (v_name, p_phone, p_wilaya_code, p_age,
          case when p_consent then now() end,
          case when p_source = 'admin' then 'admin' else 'reservation' end)
  on conflict (phone) do update
    set full_name = excluded.full_name,
        wilaya_code = excluded.wilaya_code,
        age = excluded.age,
        consent_at = coalesce(public.members.consent_at, excluded.consent_at)
  returning id into v_member_id;

  -- 4. Already has an active reservation for this trip? Return it (no duplicate).
  select * into v_existing
  from public.reservations r
  where r.trip_id = p_trip_id and r.member_id = v_member_id
    and r.status in ('pending', 'confirmed', 'waitlist')
  for update;
  if found then
    if v_existing.status = 'pending' and v_existing.hold_expires_at <= now() then
      -- Hold ran out but the job hasn't run yet: expire it and book again below.
      update public.reservations set status = 'expired' where id = v_existing.id;
    else
      return jsonb_build_object(
        'code', v_existing.code,
        'status', v_existing.status,
        'hold_expires_at', v_existing.hold_expires_at,
        'seats_left', greatest(coalesce(t.capacity, 0) - private.seats_taken(t.id), 0),
        'existing', true
      );
    end if;
  end if;

  -- Limit on simultaneous pending holds per person (public bookings only).
  if p_source = 'web' then
    select count(*) into v_pending
    from public.reservations r
    where r.member_id = v_member_id and r.status = 'pending' and r.hold_expires_at > now();
    if v_pending >= s.max_pending_per_person then
      perform private.raise_error('too_many_pending');
    end if;
  end if;

  -- 5–6. Seats left → pending hold; otherwise waitlist.
  v_taken := private.seats_taken(t.id);
  v_left := coalesce(t.capacity, 0) - v_taken;
  if v_left > 0 then
    if p_initial_status = 'confirmed' then
      v_status := 'confirmed';
      v_hold := null;
    else
      v_status := 'pending';
      v_hold := now() + make_interval(hours => t.hold_hours);
    end if;
    v_left := v_left - 1;
  else
    v_status := 'waitlist';
    v_hold := null;
  end if;

  loop
    v_code := private.new_reservation_code();
    begin
      insert into public.reservations
        (code, trip_id, member_id, status, hold_expires_at, waitlisted_at, source, admin_note,
         confirmed_at, confirmed_by)
      values
        (v_code, t.id, v_member_id, v_status, v_hold,
         case when v_status = 'waitlist' then now() end,
         p_source, p_note,
         case when v_status = 'confirmed' then now() end,
         case when v_status = 'confirmed' then (select auth.uid()) end);
      exit;
    exception when unique_violation then
      -- Code collision (rare): try another. The one-active-per-person index can't
      -- fire here because we hold the trip lock and checked above.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'reservations_code_key' then
        continue;
      end if;
      raise;
    end;
  end loop;

  -- 7. Result
  return jsonb_build_object(
    'code', v_code,
    'status', v_status,
    'hold_expires_at', v_hold,
    'seats_left', greatest(v_left, 0),
    'existing', false
  );
end;
$$;

-- Public entry point: only the server (secret key) may call it, after
-- validation, Turnstile and rate limiting.
create function public.reserve_seat(
  p_trip_id uuid,
  p_full_name text,
  p_phone text,
  p_wilaya_code text,
  p_age integer,
  p_consent boolean
) returns jsonb
language sql security definer set search_path = '' as $$
  select private.reserve_core(p_trip_id, p_full_name, p_phone, p_wilaya_code, p_age, p_consent, 'web');
$$;

-- Membership form: upsert by phone, never overwrite with empty values.
create function public.join_member(
  p_full_name text,
  p_phone text,
  p_wilaya_code text,
  p_age integer,
  p_consent boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_new boolean;
begin
  select * into s from public.settings where id;
  if char_length(v_name) not between 2 and 60
     or coalesce(p_phone, '') !~ '^\+213[567][0-9]{8}$'
     or coalesce(p_wilaya_code, '') !~ '^[0-9]{2}$'
     or p_wilaya_code::int not between 1 and 69
     or p_age is null or p_age not between s.min_age and s.max_age then
    perform private.raise_error('invalid_input');
  end if;
  if p_consent is distinct from true then
    perform private.raise_error('consent_required');
  end if;

  insert into public.members (full_name, phone, wilaya_code, age, consent_at, source)
  values (v_name, p_phone, p_wilaya_code, p_age, now(), 'join_form')
  on conflict (phone) do update
    set full_name = coalesce(nullif(excluded.full_name, ''), public.members.full_name),
        wilaya_code = coalesce(nullif(excluded.wilaya_code, ''), public.members.wilaya_code),
        age = coalesce(excluded.age, public.members.age),
        consent_at = coalesce(public.members.consent_at, excluded.consent_at)
  returning (xmax = 0) into v_new;

  return jsonb_build_object('ok', true, 'new', v_new);
end;
$$;

-- "Check my reservation": phone AND code must match; otherwise null (same answer
-- for a wrong phone or a wrong code).
create function public.reservation_status(p_phone text, p_code text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', r.code,
    'status', case when r.status = 'pending' and r.hold_expires_at <= now() then 'expired' else r.status end,
    'hold_expires_at', r.hold_expires_at,
    'trip', jsonb_build_object(
      'slug', t.slug, 'title_ar', t.title_ar, 'title_en', t.title_en,
      'start_date', t.start_date, 'end_date', t.end_date, 'status', t.status
    )
  )
  from public.reservations r
  join public.members m on m.id = r.member_id
  join public.trips t on t.id = r.trip_id
  where r.code = upper(btrim(p_code))
    and m.phone = p_phone
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting: fixed windows, strict and global. Returns true if allowed.
-- ---------------------------------------------------------------------------
create function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits)
  values (left(p_key, 200), v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions. Each re-checks capacity under the trip lock.
-- ---------------------------------------------------------------------------
create function private.lock_trip_of(p_reservation_id uuid) returns public.trips
language plpgsql set search_path = '' as $$
declare
  t public.trips;
begin
  select tr.* into t
  from public.trips tr
  join public.reservations r on r.trip_id = tr.id
  where r.id = p_reservation_id
  for update of tr;
  if not found then
    perform private.raise_error('not_found');
  end if;
  return t;
end;
$$;

create function public.admin_confirm(
  p_reservation_id uuid,
  p_payment_method text,
  p_amount_paid_da integer,
  p_override_capacity boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  r public.reservations;
  v_counted boolean;
  v_left integer;
begin
  perform private.require_admin();
  t := private.lock_trip_of(p_reservation_id);
  select * into r from public.reservations where id = p_reservation_id for update;

  if r.status not in ('pending', 'waitlist', 'expired') then
    perform private.raise_error('invalid_status');
  end if;

  -- An unexpired pending hold already occupies its seat.
  v_counted := r.status = 'pending' and r.hold_expires_at > now();
  v_left := coalesce(t.capacity, 0) - private.seats_taken(t.id);
  if not v_counted and v_left <= 0 then
    if not p_override_capacity then
      perform private.raise_error('over_capacity');
    end if;
    if not public.is_owner() then
      perform private.raise_error('owner_only');
    end if;
    perform private.write_audit('confirm_over_capacity', 'reservations', r.id::text,
      jsonb_build_object('capacity', t.capacity, 'seats_left', v_left), null);
  end if;

  update public.reservations
     set status = 'confirmed',
         hold_expires_at = null,
         waitlisted_at = null,
         payment_method = p_payment_method,
         amount_paid_da = p_amount_paid_da,
         confirmed_at = now(),
         confirmed_by = (select auth.uid())
   where id = r.id;

  return jsonb_build_object('ok', true, 'seats_left', greatest(coalesce(t.capacity, 0) - private.seats_taken(t.id), 0));
end;
$$;

create function public.admin_cancel(p_reservation_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
begin
  perform private.require_admin();
  t := private.lock_trip_of(p_reservation_id);
  update public.reservations
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 500),
         hold_expires_at = null
   where id = p_reservation_id and status in ('pending', 'confirmed', 'waitlist', 'expired');
  if not found then
    perform private.raise_error('invalid_status');
  end if;
  return jsonb_build_object('ok', true, 'seats_left', greatest(coalesce(t.capacity, 0) - private.seats_taken(t.id), 0));
end;
$$;

-- Promote from the waitlist: the given reservation, or the next in line (FIFO).
create function public.admin_promote(p_trip_id uuid, p_reservation_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_id uuid;
begin
  perform private.require_admin();
  select * into t from public.trips where id = p_trip_id for update;
  if not found then
    perform private.raise_error('not_found');
  end if;
  if coalesce(t.capacity, 0) - private.seats_taken(t.id) <= 0 then
    perform private.raise_error('over_capacity');
  end if;

  if p_reservation_id is null then
    select id into v_id from public.reservations
    where trip_id = t.id and status = 'waitlist'
    order by waitlisted_at nulls last, created_at
    limit 1 for update;
  else
    select id into v_id from public.reservations
    where id = p_reservation_id and trip_id = t.id and status = 'waitlist'
    for update;
  end if;
  if v_id is null then
    perform private.raise_error('not_found');
  end if;

  update public.reservations
     set status = 'pending', waitlisted_at = null,
         hold_expires_at = now() + make_interval(hours => t.hold_hours)
   where id = v_id;
  return jsonb_build_object('ok', true, 'reservation_id', v_id);
end;
$$;

create function public.admin_move_to_waitlist(p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.lock_trip_of(p_reservation_id);
  update public.reservations
     set status = 'waitlist', hold_expires_at = null, waitlisted_at = now(),
         confirmed_at = null, confirmed_by = null
   where id = p_reservation_id and status in ('pending', 'confirmed', 'expired');
  if not found then
    perform private.raise_error('invalid_status');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_extend_hold(p_reservation_id uuid, p_hours integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_until timestamptz;
begin
  perform private.require_admin();
  if p_hours not between 1 and 336 then
    perform private.raise_error('invalid_input');
  end if;
  perform private.lock_trip_of(p_reservation_id);
  update public.reservations
     set hold_expires_at = greatest(hold_expires_at, now()) + make_interval(hours => p_hours),
         hold_extended_at = now()
   where id = p_reservation_id and status = 'pending'
  returning hold_expires_at into v_until;
  if v_until is null then
    perform private.raise_error('invalid_status');
  end if;
  return jsonb_build_object('ok', true, 'hold_expires_at', v_until);
end;
$$;

-- For people who still book by Instagram DM.
create function public.admin_add_manual_reservation(
  p_trip_id uuid,
  p_full_name text,
  p_phone text,
  p_wilaya_code text,
  p_age integer,
  p_confirm boolean default false,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return private.reserve_core(p_trip_id, p_full_name, p_phone, p_wilaya_code, p_age, false, 'admin',
    case when p_confirm then 'confirmed' end, left(p_note, 2000));
end;
$$;

-- Exports contain personal data: every export is recorded.
create function public.log_export(p_entity text, p_entity_id text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.write_audit('export', left(p_entity, 60), left(p_entity_id, 200), null,
    jsonb_build_object('rows', p_rows));
end;
$$;

-- Storage meter for the Overview page.
create function public.admin_storage_usage() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_bytes bigint;
  v_count bigint;
begin
  perform private.require_admin();
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0), count(*)
    into v_bytes, v_count
  from storage.objects o
  where o.bucket_id = 'trip-images';
  return jsonb_build_object('bytes', v_bytes, 'objects', v_count, 'quota_bytes', 1073741824);
end;
$$;

-- ---------------------------------------------------------------------------
-- Jobs (called by the Cloudflare cron with the secret key)
-- ---------------------------------------------------------------------------
create function public.expire_holds() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.reservations set status = 'expired'
   where status = 'pending' and hold_expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Keeps counts and amounts for stats; removes the link to the person and notes.
create function public.anonymise_old_reservations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_months integer;
  v_count integer;
begin
  select retention_months into v_months from public.settings where id;
  update public.reservations r
     set member_id = null, admin_note = null, cancel_reason = null, anonymised_at = now()
    from public.trips t
   where t.id = r.trip_id
     and r.anonymised_at is null
     and coalesce(t.end_date, t.start_date) < (now() - make_interval(months => v_months))::date;
  get diagnostics v_count = row_count;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_count;
end;
$$;

-- Daily keep-alive (free projects pause after a week without activity).
create function public.keep_alive() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select now();
$$;

-- ---------------------------------------------------------------------------
-- Audit triggers: every write made by a signed-in user (admins) is logged.
-- Public/system writes (secret key, cron) have no auth.uid() and are not.
-- ---------------------------------------------------------------------------
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id text;
begin
  if (select auth.uid()) is null then
    return coalesce(new, old);
  end if;
  -- Field access via JSON: PL/pgSQL would fail on new.user_id for tables without it.
  v_id := case
    when tg_table_name = 'settings' then 'settings'
    else coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id',
                  to_jsonb(new) ->> 'user_id', to_jsonb(old) ->> 'user_id')
  end;
  perform private.write_audit(lower(tg_op), tg_table_name, v_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;

create trigger trips_audit after insert or update or delete on public.trips
  for each row execute function private.audit_row();
create trigger trip_images_audit after insert or update or delete on public.trip_images
  for each row execute function private.audit_row();
create trigger reservations_audit after insert or update or delete on public.reservations
  for each row execute function private.audit_row();
create trigger members_audit after insert or update or delete on public.members
  for each row execute function private.audit_row();
create trigger admin_users_audit after insert or update or delete on public.admin_users
  for each row execute function private.audit_row();
create trigger settings_audit after update on public.settings
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
-- Capacity can't drop below confirmed seats; publishing needs alt text on all images.
create function private.trips_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_confirmed integer;
begin
  if new.capacity is distinct from old.capacity and new.capacity is not null then
    select count(*) into v_confirmed from public.reservations
     where trip_id = new.id and status = 'confirmed';
    if new.capacity < v_confirmed then
      perform private.raise_error('capacity_below_confirmed');
    end if;
  end if;
  if new.status in ('open', 'completed') and new.status is distinct from old.status then
    if exists (select 1 from public.trip_images i
               where i.trip_id = new.id and (btrim(i.alt_ar) = '' or btrim(i.alt_en) = '')) then
      perform private.raise_error('missing_alt_text');
    end if;
  end if;
  return new;
end;
$$;
create trigger trips_guard before update on public.trips
  for each row execute function private.trips_guard();

-- There must always be at least one owner.
create function private.keep_one_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    if not exists (select 1 from public.admin_users a
                   where a.role = 'owner' and a.user_id <> old.user_id) then
      perform private.raise_error('last_owner');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger admin_users_keep_owner before update or delete on public.admin_users
  for each row execute function private.keep_one_owner();

-- Gallery size limit from settings.
create function private.trip_images_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer;
  v_count integer;
begin
  if new.kind = 'gallery' then
    select max_gallery_images into v_max from public.settings where id;
    select count(*) into v_count from public.trip_images where trip_id = new.trip_id and kind = 'gallery';
    if v_count >= v_max then
      perform private.raise_error('too_many_images');
    end if;
  end if;
  return new;
end;
$$;
create trigger trip_images_guard before insert on public.trip_images
  for each row execute function private.trip_images_guard();
