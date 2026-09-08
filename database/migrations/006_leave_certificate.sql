-- =============================================================================
-- Migration 006: Add medical certificate storage to leave_requests
-- =============================================================================

BEGIN;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS medical_certificate_name TEXT,
  ADD COLUMN IF NOT EXISTS medical_certificate_data BYTEA;

COMMIT;
