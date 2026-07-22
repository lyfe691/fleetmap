-- 0016_retire_dispatch_geofence.sql — the Bubble Box sync replaced both.
-- Point statuses arrive authoritative from upstream (M18); the geofence's
-- radius guess would fight them, and /dispatch has nothing left to manage —
-- any manual mutation is overwritten by the next sync tick. The dispatcher
-- identity and its RLS stay: they are the sync's auth.

-- The geofence's stop surface: POST /api/location no longer touches stops.
drop policy if exists "drivers can update their own vehicle stops" on stops;
drop policy if exists "drivers can read their own vehicle stops" on stops;

-- stops.address loses its last writer with /dispatch gone (the sync never
-- stored it; only the manual form and dev seeds did) — dropping it closes the
-- Realtime full-row exposure flagged in CLAUDE.md. stops_public (0011) never
-- exposed it, so the view is untouched.
alter table stops drop column if exists address;

-- ingest_stops without address (supersedes 0006's definition; the contract is
-- otherwise unchanged — the manual/dev seam keeps working for seeds/adapters).
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
      insert into stops (order_id, vehicle_id, area_id, stop_type, seq, lat, lng, eta_at)
      values (
        v_order_id,
        nullif(s->>'vehicle_id','')::uuid,
        nullif(s->>'area_id','')::uuid,
        s->>'stop_type',
        (s->>'seq')::int,
        (s->>'lat')::double precision,
        (s->>'lng')::double precision,
        nullif(s->>'eta_at','')::timestamptz
      );
    end loop;
  end loop;
end;
$$;

grant execute on function ingest_stops(jsonb) to authenticated;
