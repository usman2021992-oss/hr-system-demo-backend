-- Migration 048: Leave status constraint compatibility
-- Ensure both legacy (spaced) and current (snake_case) workflow statuses are valid.

BEGIN;

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_status_check;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_status_check
  CHECK (
    status IN (
      'pending',
      'supervisor_approved',
      'area_manager_approved',
      'hr_approved',
      'admin_approved',
      'store manager approved',
      'store manager rejected',
      'area manager approved',
      'area manager rejected',
      'HR approved',
      'HR rejected',
      'approved',
      'rejected',
      'cancelled'
    )
  );

COMMIT;
