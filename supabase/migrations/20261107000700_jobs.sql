-- Phase 8: scheduled jobs, retention, privacy deletes, orphan photo files.

-- ---------------------------------------------------------------------------
-- Job runs: the last run of each scheduled job, shown on the admin overview
-- (a cron that silently stops is otherwise invisible). Written by the Worker
-- with the secret key; admins can read it.
-- ---------------------------------------------------------------------------
create table public.job_runs (
  job text primary key check (job in ('frequent', 'daily')),
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean,
  result jsonb not null default '{}'::jsonb,
  error text check (char_length(error) <= 2000)
);
alter table public.job_runs enable row level security;
grant select on public.job_runs to authenticated;
create policy job_runs_admin_read on public.job_runs
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Retention (daily). Replaces anonymise_old_reservations():
--  * bookings of trips that ended more than retention_months ago lose the
--    link to the person and the notes (counts and amounts stay);
--  * audit log entries older than that lose the personal parts they copied
--    (member rows entirely; names/notes/links in booking rows; export search
--    terms). Who did what, and when, stays.
--  * old rate-limit counters are deleted.
-- ---------------------------------------------------------------------------
alter table public.audit_log add column redacted_at timestamptz;

create function private.redact_audit_json(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p is null then null
              else p - array['member_id', 'admin_note', 'cancel_reason', 'filter'] end;
$$;

drop function public.anonymise_old_reservations();

create function public.apply_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_months integer;
  v_cutoff timestamptz;
  v_res integer;
  v_audit integer;
  v_limits integer;
begin
  select retention_months into v_months from public.settings where id;
  v_cutoff := now() - make_interval(months => v_months);

  update public.reservations r
     set member_id = null, admin_note = null, cancel_reason = null, anonymised_at = now()
    from public.trips t
   where t.id = r.trip_id
     and r.anonymised_at is null
     and coalesce(t.end_date, t.start_date) < v_cutoff::date;
  get diagnostics v_res = row_count;

  update public.audit_log
     set before = case when entity = 'members' then null else private.redact_audit_json(before) end,
         after = case when entity = 'members' then null else private.redact_audit_json(after) end,
         redacted_at = now()
   where redacted_at is null
     and created_at < v_cutoff
     and entity in ('members', 'reservations');
  get diagnostics v_audit = row_count;

  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_limits = row_count;

  return jsonb_build_object('anonymised', v_res, 'audit_redacted', v_audit, 'rate_limits_deleted', v_limits);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privacy delete: when a member is deleted (owner, on request), their
-- bookings stay for statistics (member_id becomes null) but lose their notes,
-- and the audit log keeps who did what, not their details.
-- ---------------------------------------------------------------------------
-- Unlinks their bookings here rather than leaving it to the foreign key's
-- "on delete set null": the audit entries of a cascaded update are written
-- only after every trigger of the delete has run, too late to be redacted.
create function private.member_delete_scrub() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reservations
     set member_id = null, admin_note = null, cancel_reason = null
   where member_id = old.id;
  return old;
end;
$$;
create trigger members_scrub before delete on public.members
  for each row execute function private.member_delete_scrub();

-- After the delete (members_audit has logged it: triggers fire in name order),
-- redact everything that points to this member: their member entries (who
-- deleted whom, by id, and when stays) and every booking entry that carried
-- their member_id.
create function private.member_delete_redact_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.audit_log
     set before = null, after = null, redacted_at = now()
   where entity = 'members' and entity_id = old.id::text;
  update public.audit_log
     set before = private.redact_audit_json(before),
         after = private.redact_audit_json(after),
         redacted_at = now()
   where entity = 'reservations'
     and (before ->> 'member_id' = old.id::text or after ->> 'member_id' = old.id::text);
  return null;
end;
$$;
create trigger members_zz_redact_audit after delete on public.members
  for each row execute function private.member_delete_redact_audit();

-- ---------------------------------------------------------------------------
-- Orphan photo files: objects in trip-images that no trip_images row points
-- to (an upload that was interrupted, or a delete whose file removal failed).
-- The daily job removes them through the Storage API. Files younger than
-- p_min_age are left alone: an upload in progress has files but no row yet.
-- ---------------------------------------------------------------------------
create function public.orphan_image_objects(p_min_age interval default interval '1 day', p_limit integer default 1000)
returns table (name text, total_objects bigint)
language sql stable security definer set search_path = '' as $$
  select o.name, (select count(*) from storage.objects where bucket_id = 'trip-images') as total_objects
    from storage.objects o
   where o.bucket_id = 'trip-images'
     and o.created_at < now() - p_min_age
     and not exists (
       select 1 from public.trip_images i
        where o.name in (i.path_sm, i.path_md, i.path_lg))
   order by o.created_at
   limit greatest(1, least(p_limit, 5000));
$$;

revoke execute on function public.apply_retention() from public, anon, authenticated;
revoke execute on function public.orphan_image_objects(interval, integer) from public, anon, authenticated;
revoke execute on function private.redact_audit_json(jsonb) from public, anon, authenticated;
revoke execute on function private.member_delete_scrub() from public, anon, authenticated;
revoke execute on function private.member_delete_redact_audit() from public, anon, authenticated;
grant execute on function public.apply_retention(), public.orphan_image_objects(interval, integer) to service_role;
grant execute on all functions in schema private to service_role;
