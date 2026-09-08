-- =============================================================================
-- Migration 024: Temporary store transfers
-- - Adds temporary_store_assignments for date-bounded employee transfers
-- - Links shifts to a transfer via shifts.assignment_id
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS temporary_store_assignments (
  id                  SERIAL PRIMARY KEY,
  company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_store_id     INTEGER NOT NULL REFERENCES stores(id),
  target_store_id     INTEGER NOT NULL REFERENCES stores(id),
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'cancelled', 'completed')),
  reason              TEXT,
  notes               TEXT,
  created_by          INTEGER REFERENCES users(id),
  cancelled_by        INTEGER REFERENCES users(id),
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_date <= end_date),
  CHECK (origin_store_id <> target_store_id)
);

CREATE INDEX IF NOT EXISTS idx_temp_assignments_company_user_range
  ON temporary_store_assignments(company_id, user_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_temp_assignments_company_target_range
  ON temporary_store_assignments(company_id, target_store_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_temp_assignments_status
  ON temporary_store_assignments(status);

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS assignment_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'shifts'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'shifts_assignment_id_fkey'
  ) THEN
    ALTER TABLE shifts
      ADD CONSTRAINT shifts_assignment_id_fkey
      FOREIGN KEY (assignment_id)
      REFERENCES temporary_store_assignments(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_shifts_assignment_id
  ON shifts(assignment_id);

COMMIT;
