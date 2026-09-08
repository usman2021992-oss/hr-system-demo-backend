-- Add plain_password column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password VARCHAR(255);
