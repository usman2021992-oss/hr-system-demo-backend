-- =============================================================================
-- Migration 012: Composite indexes for shifts and attendance_events
-- Covers the most frequent query pattern: company_id + user_id + date/time.
-- Column names verified against migration 003 (shifts) and 004 (attendance_events).
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_shifts_company_user_date
  ON shifts(company_id, user_id, date);

CREATE INDEX IF NOT EXISTS idx_attendance_events_company_user_time
  ON attendance_events(company_id, user_id, event_time);
