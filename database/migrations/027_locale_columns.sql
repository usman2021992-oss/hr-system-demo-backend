-- =============================================================================
-- Migration 027: Add locale support to users and notifications
-- =============================================================================
-- IDEMPOTENT: uses ADD COLUMN IF NOT EXISTS — safe to run multiple times.
-- =============================================================================

-- Add preferred locale to users (e.g. 'it', 'en').
-- Defaults to 'it' (the primary app language) for all existing records.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'it';

-- Add locale to notifications so the stored title/message language is recorded
-- alongside each notification, enabling clients to know which language the
-- content was generated in.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'it';
