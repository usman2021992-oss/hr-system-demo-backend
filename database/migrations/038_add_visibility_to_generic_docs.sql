-- Migration: 038_add_visibility_to_generic_docs.sql
-- Description: Adds is_visible_to_roles column to the documents table to support role-based visibility for generic documents.

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS is_visible_to_roles TEXT[] NOT NULL DEFAULT ARRAY['admin','hr','area_manager','store_manager','employee'];
