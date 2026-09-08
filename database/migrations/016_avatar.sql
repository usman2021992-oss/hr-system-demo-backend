-- 016_avatar.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_filename VARCHAR(255);
