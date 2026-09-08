-- Migration 117: Add is_archived to leave_requests
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
