-- =============================================================================
-- Migration 014: Data integrity constraints and missing indexes
-- - attendance_events.shift_id FK with ON DELETE SET NULL
-- - Index on leave_balances(company_id, user_id) for fast per-user balance lookups
-- =============================================================================

-- Ensure attendance_events.shift_id has explicit ON DELETE SET NULL
-- (Drop and re-add FK if it exists without the correct ON DELETE behaviour)
DO $$
BEGIN
  -- Drop existing FK if present (name may vary)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'attendance_events'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'attendance_events_shift_id_fkey'
  ) THEN
    ALTER TABLE attendance_events DROP CONSTRAINT attendance_events_shift_id_fkey;
  END IF;

  -- Re-add with explicit ON DELETE SET NULL
  ALTER TABLE attendance_events
    ADD CONSTRAINT attendance_events_shift_id_fkey
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN
  -- Column or table may not exist yet; skip gracefully
  NULL;
END $$;

-- Index for fast leave balance lookups per user
CREATE INDEX IF NOT EXISTS idx_leave_balances_company_user
  ON leave_balances(company_id, user_id);
