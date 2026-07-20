-- Explicit role grants. The cloud project relied on Supabase's legacy
-- auto-expose defaults; new stacks (local CLI, self-host) revoke API-role
-- access to public entities unless granted. RLS remains the row boundary —
-- these grants only admit the roles to the tables the policies then scope.

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to authenticated, service_role;
grant all privileges on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- GET /api/health reads the sync heartbeat with the publishable key alone.
grant select on public.sync_state to anon;
