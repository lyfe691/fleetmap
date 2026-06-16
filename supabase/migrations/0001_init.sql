-- 0001_init.sql — M1 schema + RLS (the "pipe").
-- Authoritative data model for fleetmap. M1 is schema + RLS only:
-- no realtime publication and no REPLICA IDENTITY FULL (both are M2 concerns).

create extension if not exists pgcrypto;

create table if not exists vehicles (
  id               uuid primary key default gen_random_uuid(),
  label            text,
  status           text not null default 'active'
                     check (status in ('active', 'idle', 'offline')),
  assigned_user_id uuid unique references auth.users (id) on delete set null,
  last_lat         double precision,
  last_lng         double precision,
  last_heading     real,
  last_speed       real,
  last_seen_at     timestamptz,            -- null = never reported = offline
  dest_lat         double precision,
  dest_lng         double precision,
  created_at       timestamptz not null default now()
);

create table if not exists vehicle_positions (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references vehicles (id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  heading     real,
  speed       real,
  accuracy    real,
  recorded_at timestamptz not null,        -- device fix time
  created_at  timestamptz not null default now()
);

create index if not exists vehicle_positions_vehicle_id_recorded_at_idx
  on vehicle_positions (vehicle_id, recorded_at desc);

alter table vehicles enable row level security;
alter table vehicle_positions enable row level security;

-- vehicles: no broad "read all" policy — the TV read path (display token vs
-- anon read) is a deliberate M2 decision. Do not add a read-all policy here.
create policy "drivers can read their own vehicle"
  on vehicles for select to authenticated
  using (assigned_user_id = (select auth.uid()));

create policy "drivers can update their own vehicle"
  on vehicles for update to authenticated
  using (assigned_user_id = (select auth.uid()))
  with check (assigned_user_id = (select auth.uid()));

-- vehicle_positions: drivers append/read only their own vehicle's points.
-- No update/delete policy — history is append-only.
create policy "drivers can insert positions for their own vehicle"
  on vehicle_positions for insert to authenticated
  with check (
    exists (
      select 1 from vehicles v
      where v.id = vehicle_id
        and v.assigned_user_id = (select auth.uid())
    )
  );

create policy "drivers can read their own vehicle positions"
  on vehicle_positions for select to authenticated
  using (
    exists (
      select 1 from vehicles v
      where v.id = vehicle_id
        and v.assigned_user_id = (select auth.uid())
    )
  );
