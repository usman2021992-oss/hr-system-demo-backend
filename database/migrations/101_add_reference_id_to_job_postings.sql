-- =============================================================================
-- Migration 101: Add reference_id to job_postings
-- =============================================================================

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS reference_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'job_postings_company_reference_id_unique'
      AND t.relname = 'job_postings'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_company_reference_id_unique UNIQUE (company_id, reference_id);
  END IF;
END $$;
