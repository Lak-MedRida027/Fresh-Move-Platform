-- Security fix (review of phase 4): public forms must not change an existing
-- member's details. Anyone can type someone else's phone number, so a public
-- reservation or sign-up for an existing phone keeps the stored name / wilaya /
-- age (only a missing consent time is filled in). Admins can still edit members,
-- and admin-added reservations still update them.

create or replace function public.join_member(
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
    set consent_at = coalesce(public.members.consent_at, excluded.consent_at)
  returning (xmax = 0) into v_new;

  return jsonb_build_object('ok', true, 'new', v_new);
end;
$$;

-- reserve_core: same rule for public ('web') bookings; admin bookings may update.
create or replace function private.reserve_core(
  p_trip_id uuid,
  p_full_name text,
  p_phone text,
  p_wilaya_code text,
  p_age integer,
  p_consent boolean,
  p_source text,
  p_initial_status text default null,
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

  select * into t from public.trips where id = p_trip_id for update;
  if not found then
    perform private.raise_error('trip_not_found');
  end if;

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

  -- Upsert the member by phone. Public bookings never change an existing
  -- member's details (anyone can type a phone number); admin bookings may.
  if p_source = 'admin' then
    insert into public.members (full_name, phone, wilaya_code, age, consent_at, source)
    values (v_name, p_phone, p_wilaya_code, p_age, case when p_consent then now() end, 'admin')
    on conflict (phone) do update
      set full_name = excluded.full_name,
          wilaya_code = excluded.wilaya_code,
          age = excluded.age,
          consent_at = coalesce(public.members.consent_at, excluded.consent_at)
    returning id into v_member_id;
  else
    insert into public.members (full_name, phone, wilaya_code, age, consent_at, source)
    values (v_name, p_phone, p_wilaya_code, p_age, case when p_consent then now() end, 'reservation')
    on conflict (phone) do update
      set consent_at = coalesce(public.members.consent_at, excluded.consent_at)
    returning id into v_member_id;
  end if;

  select * into v_existing
  from public.reservations r
  where r.trip_id = p_trip_id and r.member_id = v_member_id
    and r.status in ('pending', 'confirmed', 'waitlist')
  for update;
  if found then
    if v_existing.status = 'pending' and v_existing.hold_expires_at <= now() then
      update public.reservations set status = 'expired' where id = v_existing.id;
    else
      -- The server does not pass this code to the public caller (see reserve-handler.ts).
      return jsonb_build_object(
        'code', v_existing.code,
        'status', v_existing.status,
        'hold_expires_at', v_existing.hold_expires_at,
        'seats_left', greatest(coalesce(t.capacity, 0) - private.seats_taken(t.id), 0),
        'existing', true
      );
    end if;
  end if;

  if p_source = 'web' then
    select count(*) into v_pending
    from public.reservations r
    where r.member_id = v_member_id and r.status = 'pending' and r.hold_expires_at > now();
    if v_pending >= s.max_pending_per_person then
      perform private.raise_error('too_many_pending');
    end if;
  end if;

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
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'reservations_code_key' then
        continue;
      end if;
      raise;
    end;
  end loop;

  return jsonb_build_object(
    'code', v_code,
    'status', v_status,
    'hold_expires_at', v_hold,
    'seats_left', greatest(v_left, 0),
    'existing', false
  );
end;
$$;

revoke execute on function public.join_member(text, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.join_member(text, text, text, integer, boolean) to service_role;
revoke execute on function private.reserve_core(uuid, text, text, text, integer, boolean, text, text, text) from public, anon, authenticated;
grant execute on function private.reserve_core(uuid, text, text, text, integer, boolean, text, text, text) to service_role;
