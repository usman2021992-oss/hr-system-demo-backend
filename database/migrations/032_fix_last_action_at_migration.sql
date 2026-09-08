-- Migration 032: Backfill last_action_at for inactivity escalation
-- This ensures that the 2-day inactivity rule applies correctly to requests created before this logic was added.

-- Set last_action_at to created_at for any request where it is currently NULL and the request is not yet final.
UPDATE leave_requests
SET last_action_at = created_at
WHERE last_action_at IS NULL
  AND status NOT IN ('approved', 'rejected', 'cancelled')
  AND status NOT LIKE '%rejected%';

-- Ensure future inserts have a default for last_action_at if not provided (though we will handle it in the controller too)
ALTER TABLE leave_requests ALTER COLUMN last_action_at SET DEFAULT NOW();
