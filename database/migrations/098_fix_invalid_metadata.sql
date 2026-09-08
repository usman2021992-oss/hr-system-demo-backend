-- Fix invalid metadata in notifications table
-- This migration cleans up any "[object Object]" strings in the metadata column

-- First, we need to convert the column to TEXT temporarily to clean invalid JSON
ALTER TABLE notifications ALTER COLUMN metadata TYPE TEXT;

-- Update invalid metadata to NULL
UPDATE notifications
SET metadata = NULL
WHERE metadata IS NOT NULL 
  AND (
    metadata = '[object Object]'
    OR metadata LIKE '[object%'
    OR metadata = 'undefined'
    OR metadata = 'null'
    OR metadata = ''
  );

-- Convert back to JSONB type (matching the original column type)
ALTER TABLE notifications ALTER COLUMN metadata TYPE JSONB USING 
  CASE 
    WHEN metadata IS NULL THEN NULL
    WHEN metadata = '' THEN NULL
    ELSE metadata::JSONB
  END;

-- Add a comment to document the fix
COMMENT ON COLUMN notifications.metadata IS 'JSONB metadata for deep linking. Must be valid JSON or NULL.';
