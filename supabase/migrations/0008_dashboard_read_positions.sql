-- 0008_dashboard_read_positions.sql — route replay read path.
-- The console's History tab replays a vehicle's day from vehicle_positions.
-- Same shape as the M2/M5 vehicle read path: a claim-scoped select policy for
-- the dashboard role, plus a column-scoped security_invoker view so the raw
-- table (accuracy, created_at, future columns) never reaches the TV.

drop policy if exists "dashboard role can read all vehicle positions" on vehicle_positions;
create policy "dashboard role can read all vehicle positions"
  on vehicle_positions for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dashboard');

create or replace view vehicle_positions_public
  with (security_invoker = true) as
  select
    vehicle_id,
    lat,
    lng,
    heading,
    speed,
    recorded_at
  from vehicle_positions;

grant select on vehicle_positions_public to anon, authenticated;
