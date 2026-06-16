-- 0002_dashboard_realtime.sql — M2 read path + Realtime.
-- The office-TV dashboard reads via a dedicated Auth user carrying
-- app_metadata.role='dashboard' (set only with the secret key). This adds a
-- SEPARATE permissive select policy keyed to that claim; the driver policy from
-- 0001 is untouched, and permissive policies OR together, so drivers keep
-- own-row-only while the dashboard reads all. This is the deliberate M2
-- read-path decision (display token, not anon read-all).

-- Enable Realtime on vehicles (0001 deferred this; without it no events fire).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vehicles'
  ) then
    alter publication supabase_realtime add table vehicles;
  end if;
end $$;

-- Dashboard read-only path. No insert/update/delete policy => read-only by
-- omission. The dashboard user has no assigned vehicle, so the driver policies
-- never match it.
drop policy if exists "dashboard role can read all vehicles" on vehicles;
create policy "dashboard role can read all vehicles"
  on vehicles for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dashboard');
