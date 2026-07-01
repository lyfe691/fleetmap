-- 0007_dispatcher_read_vehicles.sql — dispatcher console: read vehicles.
-- The dispatcher role already has full CRUD on orders/stops (0004) and
-- operational_areas (0006), but no policy on vehicles at all — only drivers
-- (own row, 0001) and the dashboard role (all rows, 0002) can read it. The new
-- dispatcher UI needs to list vehicles to populate a van picker when creating
-- an order. Mirrors the existing claim-scoped select pattern exactly; select
-- only — vehicle position/status stays driver-owned via POST /api/location.

create policy "dispatcher role can read vehicles"
  on vehicles for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher');
