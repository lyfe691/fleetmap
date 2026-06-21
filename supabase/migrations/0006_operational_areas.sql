-- 0006_operational_areas.sql — multi-city: operational areas + city links.
-- An operational area is a per-city service region the TV draws as a soft,
-- low-opacity overlay. Static reference data: read by the dashboard claim,
-- managed by the dispatcher, and NOT published to Realtime (boundaries don't
-- move, so the dashboard fetches them once on load). This is the "go beyond
-- Zürich" data model — vehicles and stops gain a nullable area link.

create table if not exists operational_areas (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,             -- stable key for seed/config (e.g. 'zurich')
  name        text not null,                    -- display label (e.g. 'Zürich')
  center_lat  double precision not null,
  center_lng  double precision not null,
  radius_m    double precision not null,        -- soft service radius; drives the circle overlay
  color       text not null default '#2563eb',  -- overlay tint (hex)
  boundary    jsonb,                            -- optional precise GeoJSON polygon (overrides the circle later)
  created_at  timestamptz not null default now()
);

-- Link the fleet and the stops to an area. Nullable so pre-existing rows stay
-- unassigned; on delete set null so removing an area never cascades into losing
-- a vehicle or a stop.
alter table vehicles add column if not exists
  area_id uuid references operational_areas (id) on delete set null;
alter table stops add column if not exists
  area_id uuid references operational_areas (id) on delete set null;

create index if not exists vehicles_area_id_idx on vehicles (area_id);
create index if not exists stops_area_id_idx on stops (area_id);

alter table operational_areas enable row level security;

-- dispatcher: full management (seed areas, edit boundaries/colors).
create policy "dispatcher manages operational areas"
  on operational_areas for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher');

-- dashboard: claim-scoped read (mirrors 0002/0004). Drives the map overlays.
create policy "dashboard role can read operational areas"
  on operational_areas for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dashboard');

-- Expose area_id on the column-scoped projections so the TV can group/colour the
-- fleet and stops by city (still nothing sensitive leaves the boundary).
create or replace view vehicles_public
  with (security_invoker = true) as
  select
    id,
    label,
    status,
    last_lat,
    last_lng,
    last_heading,
    last_speed,
    last_seen_at,
    area_id
  from vehicles;

create or replace view stops_public
  with (security_invoker = true) as
  select id, vehicle_id, stop_type, seq, lat, lng, status, eta_at, area_id
  from stops;

grant select on vehicles_public to anon, authenticated;
grant select on stops_public to anon, authenticated;

-- Carry area_id through the ingestion seam (supersedes 0004's definition).
-- Same atomic upsert-order / replace-set-stops contract, now tagging each stop
-- with its operational area so the TV can group/colour stops by city.
create or replace function ingest_stops(p_orders jsonb)
  returns void
  language plpgsql
as $$
declare
  o jsonb;
  s jsonb;
  v_order_id uuid;
begin
  for o in select * from jsonb_array_elements(p_orders)
  loop
    insert into orders (external_ref, source, customer_name, scheduled_date, status)
    values (
      o->>'external_ref',
      coalesce(o->>'source', 'manual'),
      o->>'customer_name',
      (o->>'scheduled_date')::date,
      'assigned'
    )
    on conflict (source, external_ref) do update
      set customer_name  = excluded.customer_name,
          scheduled_date = excluded.scheduled_date,
          status         = 'assigned',
          updated_at     = now()
    returning id into v_order_id;

    delete from stops where order_id = v_order_id;

    for s in select * from jsonb_array_elements(o->'stops')
    loop
      insert into stops (order_id, vehicle_id, area_id, stop_type, seq, lat, lng, address, eta_at)
      values (
        v_order_id,
        nullif(s->>'vehicle_id','')::uuid,
        nullif(s->>'area_id','')::uuid,
        s->>'stop_type',
        (s->>'seq')::int,
        (s->>'lat')::double precision,
        (s->>'lng')::double precision,
        s->>'address',
        nullif(s->>'eta_at','')::timestamptz
      );
    end loop;
  end loop;
end;
$$;

grant execute on function ingest_stops(jsonb) to authenticated;
