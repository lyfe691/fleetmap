-- 0013_sync_state.sql — worker heartbeat for observability.
-- The Bubble Box sync worker upserts one row per worker after each tick;
-- GET /api/health reads it (anon) to report sync freshness. No PII: a
-- timestamp and an upstream error message.

create table if not exists sync_state (
  id              text primary key,
  last_success_at timestamptz,
  last_error      text,
  last_error_at   timestamptz
);

alter table sync_state enable row level security;

create policy "dispatcher manages sync state"
  on sync_state for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher');

create policy "anyone can read sync state"
  on sync_state for select to anon, authenticated
  using (true);
