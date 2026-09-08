-- Migration: Cleanup candidate resume paths
-- Description: Remove full paths from resume_path and cv_path, keep only relative paths from cvs/ onwards
-- Also consolidate cv_path and resume_path to use resume_path as the primary field

-- Update resume_path to extract only the relative path from 'cvs/' onwards
UPDATE candidates
SET resume_path = CASE
  -- Handle paths with cvs/ directory
  WHEN resume_path IS NOT NULL AND resume_path LIKE '%cvs/%' THEN
    'cvs/' || SUBSTRING(resume_path FROM 'cvs/(.*)$')
  -- Handle paths with public-cv/ directory
  WHEN resume_path IS NOT NULL AND resume_path LIKE '%public-cv/%' THEN
    'public-cv/' || SUBSTRING(resume_path FROM 'public-cv/(.*)$')
  -- Handle Windows paths with backslashes
  WHEN resume_path IS NOT NULL AND resume_path LIKE '%\\cvs\\%' THEN
    'cvs/' || SUBSTRING(resume_path FROM '\\cvs\\(.*)$')
  WHEN resume_path IS NOT NULL AND resume_path LIKE '%\\public-cv\\%' THEN
    'public-cv/' || SUBSTRING(resume_path FROM '\\public-cv\\(.*)$')
  ELSE resume_path
END
WHERE resume_path IS NOT NULL;

-- Update cv_path to extract only the relative path from 'cvs/' onwards
UPDATE candidates
SET cv_path = CASE
  -- Handle paths with cvs/ directory
  WHEN cv_path IS NOT NULL AND cv_path LIKE '%cvs/%' THEN
    'cvs/' || SUBSTRING(cv_path FROM 'cvs/(.*)$')
  -- Handle paths with public-cv/ directory
  WHEN cv_path IS NOT NULL AND cv_path LIKE '%public-cv/%' THEN
    'public-cv/' || SUBSTRING(cv_path FROM 'public-cv/(.*)$')
  -- Handle Windows paths with backslashes
  WHEN cv_path IS NOT NULL AND cv_path LIKE '%\\cvs\\%' THEN
    'cvs/' || SUBSTRING(cv_path FROM '\\cvs\\(.*)$')
  WHEN cv_path IS NOT NULL AND cv_path LIKE '%\\public-cv\\%' THEN
    'public-cv/' || SUBSTRING(cv_path FROM '\\public-cv\\(.*)$')
  ELSE cv_path
END
WHERE cv_path IS NOT NULL;

-- Consolidate: If resume_path is null but cv_path has a value, copy cv_path to resume_path
UPDATE candidates
SET resume_path = cv_path
WHERE resume_path IS NULL AND cv_path IS NOT NULL;

-- Add comment to clarify the purpose of each column
COMMENT ON COLUMN candidates.resume_path IS 'Primary resume/CV file path (relative from cvs/ or public-cv/)';
COMMENT ON COLUMN candidates.cv_path IS 'Legacy CV path field, kept for backward compatibility';
