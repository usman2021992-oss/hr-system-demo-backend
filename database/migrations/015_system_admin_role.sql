-- 004_system_admin_role.sql
-- Add system_admin role (no company binding) and make company_id nullable
-- where needed to prevent NOT NULL violations during system_admin login/logout.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'system_admin';

ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE audit_logs ALTER COLUMN company_id DROP NOT NULL;
