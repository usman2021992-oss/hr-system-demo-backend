-- =============================================================================
-- Migration 009: Flexible break option for shifts
-- Adds break_type ('fixed'|'flexible') and break_minutes columns.
-- When break_type='flexible', break_start/break_end are NULL and
-- break_minutes holds the total allowed break duration in minutes.
-- =============================================================================
BEGIN;

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS break_type    VARCHAR(10) DEFAULT 'fixed'
    CHECK (break_type IN ('fixed', 'flexible')),
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER;

-- Back-fill: existing rows with break_start/break_end get break_type='fixed'
-- (default already covers this, explicit for clarity)
UPDATE shifts SET break_type = 'fixed' WHERE break_type IS NULL;

COMMIT;
