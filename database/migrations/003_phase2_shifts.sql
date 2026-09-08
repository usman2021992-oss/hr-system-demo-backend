-- =============================================================================
-- Migration 003: Phase 2 Shifts Schema
-- HR System Tech Demo
-- =============================================================================
-- IDEMPOTENT: Only drops legacy Phase 1 tables if they lack Phase 2 columns.
-- Safe to re-run on every server boot — will NOT destroy shift data.
-- =============================================================================

-- Drop old Phase 1 tables ONLY if shifts lacks the Phase 2 `is_split` column.
-- Once this migration has run once, the condition is false and nothing is dropped.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shifts' AND column_name = 'is_split'
  ) THEN
    DROP TABLE IF EXISTS shift_templates CASCADE;
    DROP TABLE IF EXISTS store_affluence CASCADE;
    DROP TABLE IF EXISTS shifts CASCADE;
  END IF;
END $$;

-- shifts
CREATE TABLE IF NOT EXISTS shifts (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  store_id     INTEGER NOT NULL REFERENCES stores(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  date         DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  break_start  TIME,
  break_end    TIME,
  is_split     BOOLEAN DEFAULT false,
  split_start2 TIME,
  split_end2   TIME,
  status       VARCHAR(20) DEFAULT 'scheduled'
               CHECK (status IN ('scheduled','confirmed','cancelled')),
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_company_date ON shifts(company_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_user_date    ON shifts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_store_date   ON shifts(store_id, date);

-- shift_templates
CREATE TABLE IF NOT EXISTS shift_templates (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  store_id      INTEGER NOT NULL REFERENCES stores(id),
  name          VARCHAR(100) NOT NULL,
  template_data JSONB NOT NULL,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_company_store ON shift_templates(company_id, store_id);

-- store_affluence
CREATE TABLE IF NOT EXISTS store_affluence (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id),
  store_id       INTEGER NOT NULL REFERENCES stores(id),
  iso_week       INTEGER,
  day_of_week    INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  time_slot      VARCHAR(11) NOT NULL,
  level          VARCHAR(10) NOT NULL CHECK (level IN ('low','medium','high')),
  required_staff INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affluence_store_week ON store_affluence(company_id, store_id, iso_week);
