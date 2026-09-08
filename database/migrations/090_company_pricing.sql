-- Migration for Company Pricing Configuration
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS price_per_employee NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_per_device NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_storage_price_per_gb NUMERIC(10, 2) DEFAULT 0;
