-- 0003_vehicles_public.sql — M5 read-path lockdown.
-- The dashboard snapshot read goes through a column-scoped projection instead
-- of select * on vehicles, so assigned_user_id (and any sensitive column added
-- later) never reaches the TV. security_invoker keeps the underlying RLS in
-- force, so the dashboard claim policy from 0002 still gates which rows return.

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
    last_seen_at
  from vehicles;

grant select on vehicles_public to anon, authenticated;
