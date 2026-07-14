-- 0011: expose completed_at (actual arrival) on the dashboard's stops view.
-- It's a timestamp, not PII — the TV renders scheduled vs actual arrival per
-- stop (M16 schedule adherence). Supersedes 0006's stops_public definition.
create or replace view stops_public
  with (security_invoker = true) as
  select id, vehicle_id, stop_type, seq, lat, lng, status, eta_at, completed_at, area_id
  from stops;

grant select on stops_public to anon, authenticated;
