-- =============================================================================
-- Migration 041: Add updated_at to documents
-- Description: Adds updated_at column to documents table for consistency with
--              other tables and to support soft-delete/restore logic.
-- =============================================================================

ALTER TABLE documents 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Create trigger for automatic updated_at if it's a common pattern (not required but good for auto-maintenance)
-- In this system, we usually manually set updated_at = NOW() in the queries.
