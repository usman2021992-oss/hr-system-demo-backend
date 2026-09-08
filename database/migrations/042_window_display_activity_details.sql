-- 042_window_display_activity_details.sql
ALTER TABLE window_display_activities
  ADD COLUMN IF NOT EXISTS activity_type VARCHAR(40) NOT NULL DEFAULT 'window_display',
  ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE window_display_activities
  DROP CONSTRAINT IF EXISTS chk_wda_activity_type;

ALTER TABLE window_display_activities
  ADD CONSTRAINT chk_wda_activity_type
    CHECK (activity_type IN ('window_display', 'store_cleaning', 'decoration_renovation', 'store_reset'));

ALTER TABLE window_display_activities
  DROP CONSTRAINT IF EXISTS chk_wda_duration_hours;

ALTER TABLE window_display_activities
  ADD CONSTRAINT chk_wda_duration_hours
    CHECK (duration_hours IS NULL OR (duration_hours >= 0 AND duration_hours <= 24));

CREATE INDEX IF NOT EXISTS idx_wda_year_month ON window_display_activities(year_month);
