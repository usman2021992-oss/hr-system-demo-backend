-- Migration 100: Create affluence_forecast_overrides table
-- This table stores manual store-level total visitor overrides for future dates.

CREATE TABLE IF NOT EXISTS affluence_forecast_overrides (
  id                  SERIAL PRIMARY KEY,
  store_id            INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  override_date       DATE NOT NULL,
  visitors_override   INTEGER NOT NULL CHECK (visitors_override >= 0),
  note                TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, override_date)
);
