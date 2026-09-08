-- Migration to add Discount Percent and Discount Validity dates to Companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_valid_from TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS discount_valid_to TIMESTAMP WITH TIME ZONE;
