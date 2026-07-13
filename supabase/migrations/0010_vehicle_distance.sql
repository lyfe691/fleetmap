-- 0010_vehicle_distance.sql — server-side "distance driven" aggregate.
-- The tracking view shows a vehicle's distance for the day without pulling a
-- full day of vehicle_positions to the client. security_invoker so the caller's
-- RLS applies (the dashboard role's select policy from 0008); no escalation.
-- Consecutive fixes closer than 5 m are dropped as GPS jitter.

create or replace function public.vehicle_distance_m(p_vehicle_id uuid, p_day date)
returns double precision
language sql
stable
security invoker
set search_path = public
as $$
  with pts as (
    select
      lat,
      lng,
      lag(lat) over w as plat,
      lag(lng) over w as plng
    from vehicle_positions
    where vehicle_id = p_vehicle_id
      and recorded_at >= (p_day::timestamp at time zone 'Europe/Zurich')
      and recorded_at <  ((p_day + 1)::timestamp at time zone 'Europe/Zurich')
    window w as (order by recorded_at)
  ),
  segs as (
    select
      2 * 6371000 * asin(sqrt(
        power(sin(radians(lat - plat) / 2), 2) +
        cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lng - plng) / 2), 2)
      )) as d
    from pts
    where plat is not null
  )
  select coalesce(sum(d), 0) from segs where d >= 5;
$$;

grant execute on function public.vehicle_distance_m(uuid, date) to authenticated;
