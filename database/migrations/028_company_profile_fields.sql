-- =============================================================================
-- Migration 028: Extended company profile fields
-- - Adds business profile/contact/location metadata on companies
-- =============================================================================

BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS company_phone_numbers TEXT,
  ADD COLUMN IF NOT EXISTS offices_locations TEXT,
  ADD COLUMN IF NOT EXISTS country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS timezones VARCHAR(255),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(50);

COMMIT;
