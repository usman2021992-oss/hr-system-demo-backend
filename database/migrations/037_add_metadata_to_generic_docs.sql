-- Migration: 037_add_metadata_to_generic_docs.sql
-- Description: Adds requires_signature and expires_at to the documents table for generic uploads.

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS requires_signature BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
