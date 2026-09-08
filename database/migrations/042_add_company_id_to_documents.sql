-- =============================================================================
-- Migration 042: Add company_id to generic documents
-- Description:
--   1) Adds documents.company_id for tenant-safe scoping queries.
--   2) Backfills legacy rows from employee_id or uploaded_by users.
--   3) Adds an index for company-scoped reads.
-- =============================================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;

-- Prefer employee ownership when present.
UPDATE documents d
   SET company_id = u.company_id
  FROM users u
 WHERE d.company_id IS NULL
   AND d.employee_id = u.id;

-- Fallback to uploader ownership.
UPDATE documents d
   SET company_id = u.company_id
  FROM users u
 WHERE d.company_id IS NULL
   AND d.uploaded_by = u.id;

CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents (company_id);
