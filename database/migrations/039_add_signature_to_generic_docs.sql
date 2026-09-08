-- Migration: 039_add_signature_to_generic_docs.sql
-- Description: Adds signature tracking columns to the documents table for generic uploads.

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS signed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS signed_ip INET,
ADD COLUMN IF NOT EXISTS signature_meta JSONB;
