-- =============================================================================
-- Migration 036: Relax Document Categories Uniqueness
-- Allows multiple categories with the same name for a single company as requested.
-- =============================================================================

ALTER TABLE document_categories DROP CONSTRAINT IF EXISTS document_categories_company_id_name_key;
