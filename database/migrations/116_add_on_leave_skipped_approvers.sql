-- Add column to track which roles were skipped specifically because the users in those roles were on leave.
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS on_leave_skipped_approvers JSONB DEFAULT '[]'::jsonb;
