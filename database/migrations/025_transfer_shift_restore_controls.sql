-- =============================================================================
-- Migration 025: Transfer shift restore controls
-- - Adds cancel_origin_shifts flag to transfer assignments
-- - Tracks origin shifts cancelled by transfer for safe restoration on cancel
-- =============================================================================

BEGIN;

ALTER TABLE temporary_store_assignments
  ADD COLUMN IF NOT EXISTS cancel_origin_shifts BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS cancelled_by_transfer_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'shifts'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'shifts_cancelled_by_transfer_id_fkey'
  ) THEN
    ALTER TABLE shifts
      ADD CONSTRAINT shifts_cancelled_by_transfer_id_fkey
      FOREIGN KEY (cancelled_by_transfer_id)
      REFERENCES temporary_store_assignments(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_shifts_cancelled_by_transfer_id
  ON shifts(cancelled_by_transfer_id);

COMMIT;
