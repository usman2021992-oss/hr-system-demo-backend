-- Reports become per-recipient rather than per-company.
--
-- The dashboard now shows one row per report owner: the Admin (scoped to the whole
-- company) and each HR user (scoped to their store). Each owner has their own set of
-- report schedules, so report_configurations gains an owner and a store scope.

ALTER TABLE report_configurations
  ADD COLUMN IF NOT EXISTS owner_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id) ON DELETE SET NULL;

-- The old constraint allowed exactly one row per (company, report). With owners we
-- need one row per (company, report, owner). NULL owner = the legacy company-wide row,
-- and because PostgreSQL treats NULLs as distinct in a UNIQUE constraint, the key is
-- built over COALESCE(owner_user_id, 0) so at most one company-wide row survives.
ALTER TABLE report_configurations DROP CONSTRAINT IF EXISTS unique_company_report;

CREATE UNIQUE INDEX IF NOT EXISTS unique_company_report_owner
  ON report_configurations (company_id, report_id, COALESCE(owner_user_id, 0));

CREATE INDEX IF NOT EXISTS idx_report_configurations_owner
  ON report_configurations (company_id, owner_user_id);

-- Archived PDFs inherit the same scope so an HR user only ever sees their own store's history.
ALTER TABLE generated_reports
  ADD COLUMN IF NOT EXISTS owner_user_id INT REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_generated_reports_owner
  ON generated_reports (company_id, owner_user_id, generated_at DESC);

-- Weekly reports are opt-in: they start suspended so nobody is subscribed to a
-- weekly email they never asked for. Monthly and daily keep their existing default.
ALTER TABLE report_configurations
  ALTER COLUMN status SET DEFAULT 'attivo';
