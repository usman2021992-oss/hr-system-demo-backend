-- =============================================================================
-- Migration 056: Notifications enabled flag + company feed indexes
-- =============================================================================
-- IDEMPOTENT: safe to run multiple times.
-- =============================================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_notifications_company_created
  ON notifications (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_company_unread_enabled
  ON notifications (company_id, is_read, created_at DESC)
  WHERE is_enabled = TRUE;
