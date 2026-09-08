-- ----------------------------------------------------------------------------
-- companies.is_active
-- ----------------------------------------------------------------------------
-- Enables company deactivation without deleting the company and its related data.
-- Defaults to TRUE for existing rows.
-- ----------------------------------------------------------------------------

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

