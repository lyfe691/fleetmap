-- 0009_bubblebox_sync.sql — M15: Bubble Box route sync.
-- vehicles.rider_ref maps a van to its Bubble Box rider identity.
-- sync_vehicle_routes diff-applies one vehicle's full synced picture: with a
-- 60s poll, unchanged rows must emit no Realtime event and keep their ids
-- (the TV's route cache keys on stop id:seq:status).

alter table vehicles add column if not exists rider_ref text unique;

-- SECURITY INVOKER (default): the caller's RLS (dispatcher) is the boundary,
-- same as ingest_stops (0004).
create or replace function sync_vehicle_routes(
  p_vehicle_id uuid,
  p_source text,
  p_orders jsonb
)
  returns void
  language plpgsql
as $$
declare
  o jsonb;
  s jsonb;
  v_order_id uuid;
  v_stop_id uuid;
  v_keep uuid[] := '{}';
begin
  for o in select * from jsonb_array_elements(p_orders)
  loop
    insert into orders (external_ref, source, scheduled_date, status)
    values (
      o->>'external_ref',
      p_source,
      nullif(o->>'scheduled_date', '')::date,
      'assigned'
    )
    on conflict (source, external_ref) do update
      set scheduled_date = excluded.scheduled_date,
          updated_at     = now()
    returning id into v_order_id;

    for s in select * from jsonb_array_elements(o->'stops')
    loop
      select id into v_stop_id
        from stops
        where order_id = v_order_id and stop_type = s->>'stop_type';

      if v_stop_id is null then
        insert into stops
          (order_id, vehicle_id, stop_type, seq, lat, lng, status, eta_at, completed_at)
        values (
          v_order_id,
          p_vehicle_id,
          s->>'stop_type',
          (s->>'seq')::int,
          (s->>'lat')::double precision,
          (s->>'lng')::double precision,
          s->>'status',
          nullif(s->>'eta_at', '')::timestamptz,
          nullif(s->>'completed_at', '')::timestamptz
        )
        returning id into v_stop_id;
      else
        update stops set
          vehicle_id   = p_vehicle_id,
          seq          = (s->>'seq')::int,
          lat          = (s->>'lat')::double precision,
          lng          = (s->>'lng')::double precision,
          status       = s->>'status',
          eta_at       = nullif(s->>'eta_at', '')::timestamptz,
          completed_at = nullif(s->>'completed_at', '')::timestamptz
        where id = v_stop_id
          and (
            vehicle_id   is distinct from p_vehicle_id or
            seq          is distinct from (s->>'seq')::int or
            lat          is distinct from (s->>'lat')::double precision or
            lng          is distinct from (s->>'lng')::double precision or
            status       is distinct from s->>'status' or
            eta_at       is distinct from nullif(s->>'eta_at', '')::timestamptz or
            completed_at is distinct from nullif(s->>'completed_at', '')::timestamptz
          );
      end if;

      v_keep := v_keep || v_stop_id;
    end loop;
  end loop;

  -- Synced stops on this vehicle that vanished from the picture. An empty
  -- p_orders therefore clears the vehicle.
  delete from stops st
  using orders o
  where st.vehicle_id = p_vehicle_id
    and st.order_id = o.id
    and o.source = p_source
    and not (st.id = any (v_keep));

  -- Orders of this source left with no stops anywhere (cancelled, or between
  -- pickup day and delivery day) — recreated idempotently if they reappear.
  delete from orders o
  where o.source = p_source
    and not exists (select 1 from stops st where st.order_id = o.id);
end;
$$;

grant execute on function sync_vehicle_routes(uuid, text, jsonb) to authenticated;
