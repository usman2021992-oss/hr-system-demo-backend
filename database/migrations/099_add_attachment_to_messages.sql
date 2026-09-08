-- 099_add_attachment_to_messages.sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_filename VARCHAR(255) NULL;
