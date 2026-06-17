-- 0004_orders_stops.sql — M6: order/stop model + ingestion seam.
-- orders is the business entity (holds PII) and is NEVER published to Realtime.
-- stops is the canonical map entity the dashboard reads + subscribes to.

create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  external_ref   text,
  source         text not null default 'manual',
  customer_name  text,
  status         text not null default 'new'
                   check (status in ('new','assigned','in_progress','completed','cancelled')),
  scheduled_date date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (source, external_ref)
);

create table if not exists stops (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders (id) on delete cascade,
  vehicle_id   uuid references vehicles (id) on delete set null,
  stop_type    text not null check (stop_type in ('pickup','dropoff')),
  seq          int not null,
  lat          double precision not null,
  lng          double precision not null,
  address      text,
  status       text not null default 'planned'
                 check (status in ('planned','arrived','completed','failed','skipped')),
  eta_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint stops_vehicle_seq_unique unique (vehicle_id, seq) deferrable initially deferred
);

create index if not exists stops_vehicle_id_seq_idx on stops (vehicle_id, seq);

alter table orders enable row level security;
alter table stops  enable row level security;

-- orders: dispatcher-only, full access. No dashboard/driver policy => unreadable
-- by the TV; PII never leaves the dispatcher boundary.
create policy "dispatcher manages orders"
  on orders for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher');

-- stops: dispatcher full access (insert/update/delete for replace-set + mutations).
create policy "dispatcher manages stops"
  on stops for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher');

-- stops: dashboard claim-scoped read (mirrors 0002's vehicles policy).
create policy "dashboard role can read all stops"
  on stops for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dashboard');

-- stops: driver may update only their own vehicle's stops, status transitions only.
-- Named now so the boundary exists from day one; the driver write surface lands in M9.
create policy "drivers can update their own vehicle stops"
  on stops for update to authenticated
  using (
    exists (
      select 1 from vehicles v
      where v.id = stops.vehicle_id
        and v.assigned_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from vehicles v
      where v.id = stops.vehicle_id
        and v.assigned_user_id = (select auth.uid())
    )
  );

-- Realtime: publish stops only (orders stays off the wire). REPLICA IDENTITY FULL
-- so DELETE payloads carry vehicle_id for client-side bucket eviction.
alter table stops replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stops'
  ) then
    alter publication supabase_realtime add table stops;
  end if;
end $$;

-- Column-scoped projection for the TV snapshot (mirrors 0003's vehicles_public).
create or replace view stops_public
  with (security_invoker = true) as
  select id, vehicle_id, stop_type, seq, lat, lng, status, eta_at
  from stops;

grant select on stops_public to anon, authenticated;

-- Atomic ingestion: upsert each order by (source, external_ref), replace-set its
-- stops. SECURITY INVOKER so the caller's RLS (dispatcher) remains the boundary.
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
      insert into stops (order_id, vehicle_id, stop_type, seq, lat, lng, address, eta_at)
      values (
        v_order_id,
        nullif(s->>'vehicle_id','')::uuid,
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
