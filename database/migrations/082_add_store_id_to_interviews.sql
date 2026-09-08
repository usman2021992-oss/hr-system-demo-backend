-- Migration: Add store_id to interviews table
-- Description: Add store_id column to interviews table to track which store the interview is associated with

-- Add store_id column (nullable)
ALTER TABLE interviews 
ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_interviews_store_id ON interviews(store_id);

-- Update existing interviews to set store_id from the candidate's store_id
UPDATE interviews i
SET store_id = c.store_id
FROM candidates c
WHERE i.candidate_id = c.id
  AND i.store_id IS NULL
  AND c.store_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN interviews.store_id IS 'Store ID associated with the interview (nullable, inherited from candidate)';
