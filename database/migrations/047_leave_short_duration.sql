-- Migration 047: Support full-day vs short-leave requests with time ranges

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS leave_duration_type VARCHAR(20) NOT NULL DEFAULT 'full_day',
  ADD COLUMN IF NOT EXISTS short_start_time TIME,
  ADD COLUMN IF NOT EXISTS short_end_time TIME;

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_leave_duration_type_check;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_leave_duration_type_check
  CHECK (leave_duration_type IN ('full_day', 'short_leave'));

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_duration_mode_check;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_duration_mode_check
  CHECK (
    (leave_duration_type = 'full_day' AND short_start_time IS NULL AND short_end_time IS NULL)
    OR
    (
      leave_duration_type = 'short_leave'
      AND start_date = end_date
      AND short_start_time IS NOT NULL
      AND short_end_time IS NOT NULL
      AND short_end_time > short_start_time
    )
  );
