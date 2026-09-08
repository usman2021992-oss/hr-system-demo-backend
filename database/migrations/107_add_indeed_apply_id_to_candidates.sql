-- =============================================================================
-- Migration 107: Add indeed_apply_id to candidates and create disposition logs
-- =============================================================================

-- Add indeed_apply_id to candidates table
ALTER TABLE candidates 
  ADD COLUMN IF NOT EXISTS indeed_apply_id TEXT DEFAULT NULL;

-- Create logs table for Indeed Disposition Sync attempts
CREATE TABLE IF NOT EXISTS indeed_disposition_sync_logs (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  indeed_apply_id TEXT NOT NULL,
  status_sent VARCHAR(50) NOT NULL,
  raw_status_sent VARCHAR(50) NOT NULL,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying sync history by candidate
CREATE INDEX IF NOT EXISTS idx_indeed_disposition_sync_logs_candidate 
  ON indeed_disposition_sync_logs(candidate_id);

-- Index for searching candidates by indeed_apply_id
CREATE INDEX IF NOT EXISTS idx_candidates_indeed_apply_id 
  ON candidates(indeed_apply_id);

