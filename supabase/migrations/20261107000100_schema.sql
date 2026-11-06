-- Fresh Move v2: core schema.
-- Conventions: text + CHECK instead of enums (easy to evolve), timestamptz everywhere,
-- updated_at maintained by trigger. Internal helpers live in schema `private`
-- (not exposed through the Data API). See docs/DATA_MODEL.md.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings (single row, owner-editable)
-- ---------------------------------------------------------------------------
create table public.settings (
  id boolean primary key default true check (id),
  max_pending_per_person integer not null default 3 check (max_pending_per_person between 1 and 20),
  retention_months integer not null default 12 check (retention_months between 1 and 120), -- TODO(owner): confirm
  max_gallery_images integer not null default 60 check (max_gallery_images between 1 and 500),
  default_hold_hours integer not null default 48 check (default_hold_hours between 1 and 336), -- TODO(owner): confirm
  min_age integer not null default 18 check (min_age between 10 and 99),
  max_age integer not null default 80 check (max_age between 10 and 120),
  updated_at timestamptz not null default now(),
  constraint settings_age_range check (min_age <= max_age)
);
insert into public.settings (id) values (true);

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 60),
  phone text not null unique check (phone ~ '^\+213[567][0-9]{8}$'),
  wilaya_code text not null check (wilaya_code ~ '^[0-9]{2}$' and wilaya_code::int between 1 and 69),
  age smallint not null check (age between 10 and 120),
  consent_at timestamptz,
  source text not null default 'join_form'
    check (source in ('join_form', 'reservation', 'admin', 'import')),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index members_wilaya_idx on public.members (wilaya_code);
create index members_created_idx on public.members (created_at desc);

-- ---------------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title_ar text not null check (char_length(title_ar) between 1 and 120),
  title_en text not null check (char_length(title_en) between 1 and 120),
  summary_ar text not null default '' check (char_length(summary_ar) <= 500),
  summary_en text not null default '' check (char_length(summary_en) <= 500),
  description_ar text not null default '' check (char_length(description_ar) <= 8000),
  description_en text not null default '' check (char_length(description_en) <= 8000),
  region text not null
    check (region in ('aures', 'kabylie-north-coast', 'northeast-coast', 'sahara', 'babors')),
  terrain text[] not null
    check (cardinality(terrain) >= 1
      and terrain <@ array['mountain', 'desert', 'coast', 'camping', 'heritage', 'diving']::text[]),
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  start_date date,
  end_date date,
  meeting_point_ar text check (char_length(meeting_point_ar) <= 300),
  meeting_point_en text check (char_length(meeting_point_en) <= 300),
  meeting_time time,
  price_da integer check (price_da >= 0),
  capacity integer check (capacity >= 0 and capacity <= 1000),
  hold_hours integer not null default 48 check (hold_hours between 1 and 336),
  registration_deadline timestamptz,
  payment_instructions_ar text not null default '' check (char_length(payment_instructions_ar) <= 4000),
  payment_instructions_en text not null default '' check (char_length(payment_instructions_en) <= 4000),
  what_to_bring_ar text not null default '' check (char_length(what_to_bring_ar) <= 4000),
  what_to_bring_en text not null default '' check (char_length(what_to_bring_en) <= 4000),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed', 'completed', 'cancelled')),
  instagram_post_url text check (instagram_post_url ~ '^https://(www\.)?instagram\.com/'),
  featured boolean not null default false,
  cover_image_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_dates_order check (end_date is null or start_date is null or end_date >= start_date),
  -- Imported past trips may lack dates/difficulty; anything bookable must be complete.
  constraint trips_bookable_complete check (
    status not in ('open', 'closed')
    or (start_date is not null and end_date is not null and difficulty is not null
        and price_da is not null and capacity is not null)
  )
);
create index trips_status_start_idx on public.trips (status, start_date);

-- ---------------------------------------------------------------------------
-- Trip images (poster / gallery), three pre-sized WebP files each
-- ---------------------------------------------------------------------------
create table public.trip_images (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind text not null check (kind in ('poster', 'gallery')),
  path_sm text not null check (char_length(path_sm) <= 300),
  path_md text not null check (char_length(path_md) <= 300),
  path_lg text not null check (char_length(path_lg) <= 300),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  placeholder text check (char_length(placeholder) <= 4000), -- tiny data:image/webp;base64,…
  size_bytes integer not null default 0 check (size_bytes >= 0),
  alt_ar text not null default '' check (char_length(alt_ar) <= 300),
  alt_en text not null default '' check (char_length(alt_en) <= 300),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index trip_images_trip_idx on public.trip_images (trip_id, kind, sort_order);

alter table public.trips
  add constraint trips_cover_fk foreign key (cover_image_id)
  references public.trip_images (id) on delete set null;
create index trips_cover_idx on public.trips (cover_image_id);

-- ---------------------------------------------------------------------------
-- Reservations
-- ---------------------------------------------------------------------------
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  -- FM- + 5 chars from 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (no 0/O/1/I)
  code text not null unique check (code ~ '^FM-[2-9A-HJ-NP-Z]{5}$'),
  trip_id uuid not null references public.trips (id) on delete restrict,
  -- Null once the member is deleted (privacy) or the row is anonymised (retention).
  member_id uuid references public.members (id) on delete set null,
  status text not null check (status in ('pending', 'confirmed', 'waitlist', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  waitlisted_at timestamptz, -- waitlist order (FIFO)
  payment_method text check (payment_method in ('baridimob', 'ccp', 'cash', 'other')),
  amount_paid_da integer check (amount_paid_da >= 0),
  admin_note text check (char_length(admin_note) <= 2000),
  source text not null default 'web' check (source in ('web', 'admin')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  hold_extended_at timestamptz,
  anonymised_at timestamptz,
  constraint reservations_pending_has_hold check (status <> 'pending' or hold_expires_at is not null)
);
-- One active reservation per person per trip.
create unique index reservations_one_active_idx on public.reservations (trip_id, member_id)
  where status in ('pending', 'confirmed', 'waitlist');
create index reservations_trip_status_idx on public.reservations (trip_id, status);
create index reservations_member_idx on public.reservations (member_id);
create index reservations_hold_idx on public.reservations (hold_expires_at) where status = 'pending';
create index reservations_confirmed_by_idx on public.reservations (confirmed_by);
create index reservations_created_idx on public.reservations (created_at desc);

-- ---------------------------------------------------------------------------
-- Admins and audit
-- ---------------------------------------------------------------------------
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'organizer')),
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 60),
  entity text not null check (char_length(entity) <= 60),
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_user_id);

-- ---------------------------------------------------------------------------
-- Rate limiting (strict, global; used by the server for per-phone / per-code limits)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger members_touch before update on public.members
  for each row execute function private.touch_updated_at();
create trigger trips_touch before update on public.trips
  for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();
