-- =============================================================================
-- Migration 020: Add MIME type column to leave_requests for certificate storage
-- =============================================================================

BEGIN;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS medical_certificate_type VARCHAR(100);

COMMIT;
