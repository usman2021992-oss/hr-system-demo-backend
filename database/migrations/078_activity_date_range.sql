-- 078_activity_date_range.sql
-- Add start_date and end_date columns to window_display_activities
-- Migrate existing single date to date range (start_date = end_date = date)

-- Add new columns
ALTER TABLE window_display_activities
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- Migrate existing data: set start_date and end_date to the current date value
UPDATE window_display_activities
SET start_date = date,
    end_date = date
WHERE start_date IS NULL OR end_date IS NULL;

-- Make the new columns NOT NULL after migration
ALTER TABLE window_display_activities
  ALTER COLUMN start_date SET NOT NULL,
  ALTER COLUMN end_date SET NOT NULL;

-- Add constraint to ensure end_date >= start_date
ALTER TABLE window_display_activities
  DROP CONSTRAINT IF EXISTS chk_wda_date_range;

ALTER TABLE window_display_activities
  ADD CONSTRAINT chk_wda_date_range
    CHECK (end_date >= start_date);

-- Update the unique constraint to allow multiple activities per store in same month
-- as long as they have different date ranges
ALTER TABLE window_display_activities
  DROP CONSTRAINT IF EXISTS window_display_activities_company_id_store_id_year_month_key;

-- Create index for date range queries
CREATE INDEX IF NOT EXISTS idx_wda_date_range ON window_display_activities(store_id, start_date, end_date);

-- Keep the date column for backward compatibility (will be deprecated later)
-- The date column will store the start_date value
UPDATE window_display_activities
SET date = start_date
WHERE date != start_date;

COMMENT ON COLUMN window_display_activities.start_date IS 'Activity start date (inclusive)';
COMMENT ON COLUMN window_display_activities.end_date IS 'Activity end date (inclusive)';
COMMENT ON COLUMN window_display_activities.date IS 'Deprecated: Use start_date instead. Kept for backward compatibility.';
