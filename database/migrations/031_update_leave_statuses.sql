-- Migration 031: Update Leave Statuses for Enhanced Workflow
-- HR System Tech Demo

BEGIN;

-- 1. Drop old constraint
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;

-- 2. Update existing data to match new naming convention
-- Mapping:
-- supervisor_approved   -> store manager approved
-- area_manager_approved -> area manager approved
-- hr_approved           -> HR approved
-- admin_approved        -> approved

UPDATE leave_requests SET status = 'store manager approved' WHERE status = 'supervisor_approved';
UPDATE leave_requests SET status = 'area manager approved' WHERE status = 'area_manager_approved';
UPDATE leave_requests SET status = 'HR approved'           WHERE status = 'hr_approved';
UPDATE leave_requests SET status = 'approved'              WHERE status = 'admin_approved';

-- 3. Add new constraint with all required values
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check 
  CHECK (status IN (
    'pending', 
    'store manager approved', 
    'store manager rejected', 
    'area manager approved', 
    'area manager rejected', 
    'HR approved', 
    'HR rejected', 
    'approved', 
    'rejected', 
    'cancelled'
  ));

COMMIT;
