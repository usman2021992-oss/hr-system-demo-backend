-- =============================================================================
-- Migration 008: Add termination_type to users
-- =============================================================================
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS
  termination_type VARCHAR(50);

COMMIT;
