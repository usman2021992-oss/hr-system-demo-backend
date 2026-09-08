-- Migration 093: Add phone to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(255);
