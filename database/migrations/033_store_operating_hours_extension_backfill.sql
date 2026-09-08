-- =============================================================================
-- Migration 033: Backfill store operating hours extension
-- Ensures extended planning columns/checks exist even when migration 024 ran
-- before the base table was created in older deployment sequences.
-- =============================================================================

DO $$
DECLARE
  store_hours_tbl regclass;
BEGIN
  store_hours_tbl := to_regclass('public.store_operating_hours');

  IF store_hours_tbl IS NULL THEN
    RAISE NOTICE 'Skipping 033_store_operating_hours_extension_backfill.sql because store_operating_hours does not exist.';
    RETURN;
  END IF;

  ALTER TABLE store_operating_hours
    ADD COLUMN IF NOT EXISTS peak_start_time TIME,
    ADD COLUMN IF NOT EXISTS peak_end_time TIME,
    ADD COLUMN IF NOT EXISTS planned_shift_count INTEGER,
    ADD COLUMN IF NOT EXISTS planned_staff_count INTEGER,
    ADD COLUMN IF NOT EXISTS shift_plan_notes TEXT;

  UPDATE store_operating_hours
  SET peak_start_time = NULL,
      peak_end_time = NULL
  WHERE (peak_start_time IS NULL) <> (peak_end_time IS NULL);

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_operating_hours_peak_pair_chk'
      AND conrelid = store_hours_tbl
  ) THEN
    ALTER TABLE store_operating_hours
      ADD CONSTRAINT store_operating_hours_peak_pair_chk
      CHECK (
        (peak_start_time IS NULL AND peak_end_time IS NULL)
        OR (peak_start_time IS NOT NULL AND peak_end_time IS NOT NULL AND peak_start_time < peak_end_time)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_operating_hours_peak_inside_opening_chk'
      AND conrelid = store_hours_tbl
  ) THEN
    ALTER TABLE store_operating_hours
      ADD CONSTRAINT store_operating_hours_peak_inside_opening_chk
      CHECK (
        is_closed = true
        OR peak_start_time IS NULL
        OR (peak_start_time >= open_time AND peak_end_time <= close_time)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_operating_hours_planned_shift_count_chk'
      AND conrelid = store_hours_tbl
  ) THEN
    ALTER TABLE store_operating_hours
      ADD CONSTRAINT store_operating_hours_planned_shift_count_chk
      CHECK (planned_shift_count IS NULL OR planned_shift_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_operating_hours_planned_staff_count_chk'
      AND conrelid = store_hours_tbl
  ) THEN
    ALTER TABLE store_operating_hours
      ADD CONSTRAINT store_operating_hours_planned_staff_count_chk
      CHECK (planned_staff_count IS NULL OR planned_staff_count >= 0);
  END IF;
END $$;
