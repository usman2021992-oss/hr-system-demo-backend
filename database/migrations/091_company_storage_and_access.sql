-- Migration to add Storage Limit and Access Validity dates to Companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS storage_limit_gb NUMERIC(10, 2) DEFAULT 500.00,
  ADD COLUMN IF NOT EXISTS access_valid_from TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS access_valid_to TIMESTAMP WITH TIME ZONE;
