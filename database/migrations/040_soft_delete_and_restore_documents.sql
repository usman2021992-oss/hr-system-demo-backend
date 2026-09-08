-- =============================================================================
-- Migration 040: Soft Delete & Restore Documents
-- Description: Adds is_deleted, restored_at, restored_by to documents and 
--              employee_documents. Adds deleted_at to documents.
-- =============================================================================

-- 1. employee_documents enhancements
ALTER TABLE employee_documents 
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Backfill is_deleted for existing soft-deleted records in employee_documents
UPDATE employee_documents SET is_deleted = TRUE WHERE deleted_at IS NOT NULL;

-- 2. documents enhancements (generic table)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Create indices for better performance on filtered queries
CREATE INDEX IF NOT EXISTS idx_employee_documents_is_deleted ON employee_documents (is_deleted);
CREATE INDEX IF NOT EXISTS idx_documents_is_deleted ON documents (is_deleted);
