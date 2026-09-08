-- Migration 116: Add is_required to job_screener_questions
ALTER TABLE job_screener_questions ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT true;
