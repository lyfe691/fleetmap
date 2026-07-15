-- 0014_vehicle_positions_created_at_idx.sql — index for the nightly prune.
-- 0012 deletes by created_at; the only existing index is (vehicle_id,
-- recorded_at), which can't serve that predicate — without this every run
-- is a full table scan that grows with the fleet.

create index if not exists vehicle_positions_created_at_idx
  on vehicle_positions (created_at);
