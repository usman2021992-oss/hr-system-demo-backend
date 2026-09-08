-- Migration 049: Company-level external affluence calculation settings

BEGIN;

CREATE TABLE IF NOT EXISTS company_external_affluence_settings (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  visitors_per_staff NUMERIC(10,2) NOT NULL DEFAULT 10,
  slot_weight_0900_1200 NUMERIC(8,4) NOT NULL DEFAULT 0.22,
  slot_weight_1200_1500 NUMERIC(8,4) NOT NULL DEFAULT 0.30,
  slot_weight_1500_1800 NUMERIC(8,4) NOT NULL DEFAULT 0.28,
  slot_weight_1800_2100 NUMERIC(8,4) NOT NULL DEFAULT 0.20,
  low_max_staff INTEGER NOT NULL DEFAULT 2,
  medium_max_staff INTEGER NOT NULL DEFAULT 4,
  coverage_tolerance NUMERIC(8,4) NOT NULL DEFAULT 0.40,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
