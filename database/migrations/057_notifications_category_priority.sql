-- =============================================================================
-- Migration 057: Add category and priority to notifications table
-- =============================================================================
-- IDEMPOTENT: safe to run multiple times.
-- =============================================================================

-- Add category field to track which module the notification is from
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Add index for category filtering
CREATE INDEX IF NOT EXISTS idx_notifications_category
  ON notifications (category, created_at DESC);

-- Add priority field to notification_settings for customizable priorities
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';

-- Add locale field to notification_settings for language-specific notifications
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS locale TEXT;

