-- 043_window_display_activity_icon.sql
ALTER TABLE window_display_activities
  ADD COLUMN IF NOT EXISTS activity_icon VARCHAR(16);
