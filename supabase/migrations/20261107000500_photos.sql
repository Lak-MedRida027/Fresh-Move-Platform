-- Phase 6: trip photos.
--
-- 1. Every photo's three files live at trips/<trip_id>/<image_id>-{sm,md,lg}.webp.
--    Enforcing it means deleting a photo or a trip can always find the files.
-- 2. The public only sees photos that have alt text in both languages. Publishing
--    is already blocked while a photo lacks it; this also covers a photo added to
--    a trip that is already public.
-- 3. Closed trips are public too, so closing also needs alt text.
-- 4. admin_reorder_images: one atomic call to set the order of a trip's photos.

alter table public.trip_images
  add constraint trip_images_paths check (
    path_sm = 'trips/' || trip_id::text || '/' || id::text || '-sm.webp'
    and path_md = 'trips/' || trip_id::text || '/' || id::text || '-md.webp'
    and path_lg = 'trips/' || trip_id::text || '/' || id::text || '-lg.webp'
  );

drop policy trip_images_public_read on public.trip_images;
create policy trip_images_public_read on public.trip_images
  for select to anon, authenticated
  using (
    (
      btrim(alt_ar) <> '' and btrim(alt_en) <> ''
      and exists (select 1 from public.trips t
                  where t.id = trip_id and t.status in ('open', 'closed', 'completed'))
    )
    or (select public.is_admin())
  );

create or replace function private.trips_guard() returns trigger
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
  if new.status in ('open', 'closed', 'completed') and new.status is distinct from old.status then
    if exists (select 1 from public.trip_images i
               where i.trip_id = new.id and (btrim(i.alt_ar) = '' or btrim(i.alt_en) = '')) then
      perform private.raise_error('missing_alt_text');
    end if;
  end if;
  return new;
end;
$$;

-- p_ids: every photo of the trip, in the new order.
create function public.admin_reorder_images(p_trip_id uuid, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform private.require_admin();
  select count(*) into v_count from public.trip_images where trip_id = p_trip_id;
  if p_ids is null
     or cardinality(p_ids) <> v_count
     or (select count(distinct x) from unnest(p_ids) as x) <> v_count
     or exists (select 1 from unnest(p_ids) as x
                where not exists (select 1 from public.trip_images i
                                  where i.id = x and i.trip_id = p_trip_id)) then
    perform private.raise_error('invalid_input');
  end if;
  update public.trip_images i
     set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where i.id = o.id and i.sort_order is distinct from o.ord;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.admin_reorder_images(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_reorder_images(uuid, uuid[]) to authenticated;
