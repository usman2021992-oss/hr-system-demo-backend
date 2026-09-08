ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS escalated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS skipped_approvers JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_emergency_override BOOLEAN DEFAULT FALSE;

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check 
  CHECK (status IN (
    'pending', 
    'supervisor_approved', 'area_manager_approved', 'hr_approved', 'admin_approved',
    'store manager approved', 'store manager rejected',
    'area manager approved', 'area manager rejected',
    'HR approved', 'HR rejected',
    'approved', 'rejected', 'cancelled'
  ));
