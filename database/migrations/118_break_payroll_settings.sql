-- Company-level break & payroll settings
CREATE TABLE IF NOT EXISTS company_break_settings (
  id                         SERIAL PRIMARY KEY,
  company_id                 INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  break_enforcement_enabled  BOOLEAN NOT NULL DEFAULT false,   -- false = Option B (Standard), true = Option A (Strict)
  break_tolerance_minutes    INTEGER NOT NULL DEFAULT 10,      -- threshold tolerance in minutes
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id)
);

-- Split shift break fields on shifts table
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS split_break_start   TIME,
  ADD COLUMN IF NOT EXISTS split_break_end     TIME,
  ADD COLUMN IF NOT EXISTS split_break_type    VARCHAR(10) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS split_break_minutes INTEGER;
