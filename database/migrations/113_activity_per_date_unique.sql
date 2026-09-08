-- Migration 113: One store activity per calendar date (replace stale per-month uniqueness)
--
-- Background
--   Migration 038 created `unique_store_month UNIQUE (store_id, year_month)`, limiting each
--   store to a single activity per calendar month. Migration 078 intended to lift that limit
--   but dropped a constraint by a name that never existed
--   (`window_display_activities_company_id_store_id_year_month_key`), so the restriction was
--   silently left in place. That is the root cause of both the "second activity overwrites the
--   first" behaviour and the WINDOW_DISPLAY_ALREADY_SET (23505) error.
--
-- What this does
--   1. Correctly removes the per-month restriction (constraint + backing index).
--   2. Adds per-date uniqueness so a store can hold many activities in a month, but only one
--      activity per date (any activity type).
--
-- Data safety
--   Under the old (store_id, year_month) rule it is impossible for two rows to share the same
--   (store_id, start_date), so adding the new constraint cannot conflict with existing rows.
--   No rows are modified or deleted by this migration.

DO $$
BEGIN
  -- 1. Remove the stale one-activity-per-month restriction (constraint drops its backing index).
  ALTER TABLE window_display_activities
    DROP CONSTRAINT IF EXISTS unique_store_month;

  -- Defensive: drop a same-named standalone index if one somehow lingers.
  DROP INDEX IF EXISTS unique_store_month;

  -- 2. Enforce one activity per store per calendar date (any activity type).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_wda_store_start_date'
      AND conrelid = 'window_display_activities'::regclass
  ) THEN
    ALTER TABLE window_display_activities
      ADD CONSTRAINT uq_wda_store_start_date UNIQUE (store_id, start_date);
  END IF;
END $$;

COMMENT ON CONSTRAINT uq_wda_store_start_date ON window_display_activities
  IS 'One store activity per date (any type). Replaces the removed unique_store_month per-month restriction.';
