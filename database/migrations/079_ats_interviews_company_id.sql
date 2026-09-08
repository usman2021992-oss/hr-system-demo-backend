-- Add company_id to interviews table for better data organization and querying
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS company_id INTEGER;

-- Backfill company_id from candidates table (only if candidates exist)
UPDATE interviews i
SET company_id = c.company_id
FROM candidates c
WHERE i.candidate_id = c.id
  AND i.company_id IS NULL
  AND c.company_id IS NOT NULL;

-- Delete any orphaned interviews that don't have a valid candidate or company_id
-- This handles edge cases where data integrity was compromised
DELETE FROM interviews
WHERE company_id IS NULL;

-- Only proceed with constraints if companies table has data
-- This prevents issues during seed when tables are dropped and rebuilt
DO $$
DECLARE
  company_count INTEGER;
  interview_count INTEGER;
BEGIN
  -- Check if companies table has data
  SELECT COUNT(*) INTO company_count FROM companies;
  SELECT COUNT(*) INTO interview_count FROM interviews;
  
  -- Only add constraints if companies exist OR if interviews table is empty
  IF company_count > 0 OR interview_count = 0 THEN
    -- Set NOT NULL only if there are interviews
    IF interview_count > 0 THEN
      ALTER TABLE interviews ALTER COLUMN company_id SET NOT NULL;
    END IF;
    
    -- Add foreign key constraint if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_interviews_company'
    ) THEN
      ALTER TABLE interviews
      ADD CONSTRAINT fk_interviews_company
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
    END IF;
  ELSE
    -- Companies table is empty but interviews exist - this is the seed scenario
    -- Skip constraint addition, it will be added on next migration run after seed completes
    RAISE NOTICE 'Skipping constraint addition - companies table is empty (seed in progress)';
  END IF;
END $$;

-- Add indexes for better query performance (always safe to add)
CREATE INDEX IF NOT EXISTS idx_interviews_company_id ON interviews(company_id);
CREATE INDEX IF NOT EXISTS idx_interviews_candidate_company ON interviews(candidate_id, company_id);
