-- Company-specific SMTP configuration
-- One record per company; upserted by Admin/HR via the Email Settings page.
-- If no record exists for a company, email sending is silently skipped.

CREATE TABLE IF NOT EXISTS company_smtp_configs (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  smtp_host   TEXT    NOT NULL DEFAULT '',
  smtp_port   INTEGER NOT NULL DEFAULT 587,
  smtp_user   TEXT    NOT NULL DEFAULT '',
  smtp_pass   TEXT    NOT NULL DEFAULT '',
  smtp_from   TEXT    NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_smtp_configs_company_id
  ON company_smtp_configs (company_id);
