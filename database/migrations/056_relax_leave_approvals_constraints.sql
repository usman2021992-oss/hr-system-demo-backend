-- Migration 056: Relax leave_approvals constraints for system actions
-- This allows automated escalations to be recorded without a specific approver_id.

BEGIN;

-- 1. Drop the NOT NULL constraint from approver_id
ALTER TABLE leave_approvals ALTER COLUMN approver_id DROP NOT NULL;

-- 2. Drop the old action check constraint
ALTER TABLE leave_approvals DROP CONSTRAINT IF EXISTS leave_approvals_action_check;

-- 3. Add updated action check constraint that includes 'escalated'
ALTER TABLE leave_approvals ADD CONSTRAINT leave_approvals_action_check 
  CHECK (action IN ('approved', 'rejected', 'escalated'));

COMMIT;
