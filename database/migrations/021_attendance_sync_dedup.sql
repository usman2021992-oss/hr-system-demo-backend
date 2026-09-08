-- =============================================================================
-- Migration 021: Add unique constraint on attendance_events for sync deduplication
-- Prevents duplicate records when the frontend retries an offline batch sync.
-- =============================================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_attendance_event'
  ) THEN
    ALTER TABLE attendance_events
      ADD CONSTRAINT uq_attendance_event UNIQUE (company_id, user_id, event_type, event_time);
  END IF;
END $$;

COMMIT;
