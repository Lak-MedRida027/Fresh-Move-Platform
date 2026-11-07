-- Phase 7: Excel exports.
--
-- Exports contain personal data, so each one is recorded in the audit log:
-- who exported which list, with which filters, and how many rows. The admin
-- export endpoint calls this before it returns any rows; if logging fails,
-- nothing is exported.
--
-- Replaces the phase 2 version, which only stored the row count.

drop function public.log_export(text, text, integer);

create function public.log_export(
  p_entity text,
  p_entity_id text,
  p_rows integer,
  p_filter jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_entity is null or p_entity not in ('reservations', 'members')
     or p_rows is null or p_rows < 0
     or p_filter is null or jsonb_typeof(p_filter) <> 'object'
     or octet_length(p_filter::text) > 1000
     or char_length(coalesce(p_entity_id, '')) > 200 then
    perform private.raise_error('invalid_input');
  end if;
  perform private.write_audit('export', p_entity, p_entity_id, null,
    jsonb_build_object('rows', p_rows, 'filter', p_filter));
end;
$$;

revoke execute on function public.log_export(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.log_export(text, text, integer, jsonb) to authenticated;
