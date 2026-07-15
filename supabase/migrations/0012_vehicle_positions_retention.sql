-- 0012_vehicle_positions_retention.sql — nightly prune of GPS history.
-- vehicle_positions is append-only (one row per GPS tick from every van) and
-- nothing bounded it; History replay reads a single day. Keep 30 days.
-- Prunes by created_at (server insert time) — recorded_at is device fix time
-- and a skewed phone clock must not decide retention.

create extension if not exists pg_cron;

select cron.schedule(
  'prune-vehicle-positions',
  '17 2 * * *',
  $$delete from vehicle_positions where created_at < now() - interval '30 days'$$
);
