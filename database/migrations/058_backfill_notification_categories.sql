-- =============================================================================
-- Migration 058: Backfill notification categories for existing records
-- =============================================================================
-- IDEMPOTENT: safe to run multiple times.
-- =============================================================================

-- Update existing notifications to have categories based on their type
UPDATE notifications
SET category = CASE
  WHEN type LIKE 'employee.%' THEN 'employees'
  WHEN type LIKE 'shift.%' THEN 'shifts'
  WHEN type LIKE 'attendance.%' THEN 'attendance'
  WHEN type LIKE 'leave.%' THEN 'leave'
  WHEN type LIKE 'document.%' THEN 'documents'
  WHEN type LIKE 'ats.%' THEN 'ats'
  WHEN type LIKE 'onboarding.%' THEN 'onboarding'
  WHEN type LIKE 'manager.%' THEN 'manager'
  ELSE 'manager'
END
WHERE category IS NULL;
