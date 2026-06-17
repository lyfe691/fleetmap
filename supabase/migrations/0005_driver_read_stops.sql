-- 0005_driver_read_stops.sql — M9: driver read surface for the geofence.
-- POST /api/location runs as the driver and must read its vehicle's next stop to
-- evaluate the geofence. 0004 added a driver UPDATE policy on stops but no SELECT;
-- add the matching SELECT, scoped to the driver's own assigned vehicle.
create policy "drivers can read their own vehicle stops"
  on stops for select to authenticated
  using (
    exists (
      select 1 from vehicles v
      where v.id = stops.vehicle_id
        and v.assigned_user_id = (select auth.uid())
    )
  );
