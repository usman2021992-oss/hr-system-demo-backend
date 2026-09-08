-- =============================================================================
-- Migration 060: Add category to notification_settings table
-- =============================================================================
-- IDEMPOTENT: safe to run multiple times.
-- =============================================================================

-- Add category field to notification_settings
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Update existing records with categories based on event_key
UPDATE notification_settings
SET category = CASE
  WHEN event_key LIKE 'employee.%' THEN 'employees'
  WHEN event_key LIKE 'shift.%' THEN 'shifts'
  WHEN event_key LIKE 'attendance.%' THEN 'attendance'
  WHEN event_key LIKE 'leave.%' THEN 'leave'
  WHEN event_key LIKE 'document.%' THEN 'documents'
  WHEN event_key LIKE 'ats.%' THEN 'ats'
  WHEN event_key LIKE 'onboarding.%' THEN 'onboarding'
  WHEN event_key LIKE 'manager.%' THEN 'manager'
  ELSE 'manager'
END
WHERE category IS NULL;

-- Add index for category
CREATE INDEX IF NOT EXISTS idx_notification_settings_category
  ON notification_settings (category);
