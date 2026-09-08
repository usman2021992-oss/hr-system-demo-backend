-- Reports KPI redesign: period selection, exception thresholds, PDF size caps, retention.
-- Reports become KPI dashboards (summary + exceptions + capped appendix) rather than data exports,
-- so each configuration now carries the knobs that bound the output.

ALTER TABLE report_configurations
  ADD COLUMN IF NOT EXISTS period VARCHAR(20) NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS custom_start DATE,
  ADD COLUMN IF NOT EXISTS custom_end DATE,
  ADD COLUMN IF NOT EXISTS thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS max_pages INT NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS max_rows_per_section INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS retention_count INT NOT NULL DEFAULT 24;

-- 'auto' keeps each report on its historical window (weekly=7d, monthly=30d, daily=1d).
-- 'custom' uses custom_start/custom_end.
ALTER TABLE report_configurations
  DROP CONSTRAINT IF EXISTS report_configurations_period_check;
ALTER TABLE report_configurations
  ADD CONSTRAINT report_configurations_period_check
  CHECK (period IN ('auto', 'daily', 'weekly', 'monthly', 'quarterly', 'custom'));

-- A custom period is only coherent when both bounds are present and ordered.
ALTER TABLE report_configurations
  DROP CONSTRAINT IF EXISTS report_configurations_custom_range_check;
ALTER TABLE report_configurations
  ADD CONSTRAINT report_configurations_custom_range_check
  CHECK (
    period <> 'custom'
    OR (custom_start IS NOT NULL AND custom_end IS NOT NULL AND custom_start <= custom_end)
  );

-- Archive paging orders by generated_at DESC and filters by company; index both.
CREATE INDEX IF NOT EXISTS idx_generated_reports_company_generated
  ON generated_reports (company_id, generated_at DESC);

-- Retention purge deletes oldest-first within (company, report_id).
CREATE INDEX IF NOT EXISTS idx_generated_reports_company_report_generated
  ON generated_reports (company_id, report_id, generated_at DESC);
