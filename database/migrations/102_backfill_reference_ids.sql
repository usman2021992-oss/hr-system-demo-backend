-- =============================================================================
-- Migration 102: Backfill reference_id for existing job_postings
-- =============================================================================

WITH numbered_jobs AS (
  SELECT
    j.id,
    c.slug,
    ROW_NUMBER() OVER (PARTITION BY j.company_id ORDER BY j.id) as seq
  FROM job_postings j
  JOIN companies c ON c.id = j.company_id
  WHERE j.reference_id IS NULL
)
UPDATE job_postings j
SET reference_id = 'VY-' || UPPER(SUBSTRING(RPAD(REGEXP_REPLACE(nj.slug, '[^a-zA-Z]', '', 'g'), 2, 'X'), 1, 2)) || '-' || LPAD(nj.seq::text, 4, '0')
FROM numbered_jobs nj
WHERE j.id = nj.id AND j.reference_id IS NULL;
