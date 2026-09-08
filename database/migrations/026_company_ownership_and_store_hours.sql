-- =============================================================================
-- Migration 026: Company ownership and store operating hours
-- - Adds ownership and banner fields for companies/company groups
-- - Adds normalized store operating hours table
-- =============================================================================

BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS banner_filename VARCHAR(255);

ALTER TABLE company_groups
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS store_operating_hours (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  open_time TIME,
  close_time TIME,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (is_closed = true AND open_time IS NULL AND close_time IS NULL)
    OR (is_closed = false AND open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)
  ),
  UNIQUE (store_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_store_operating_hours_store
  ON store_operating_hours(store_id);

COMMIT;
