CREATE TABLE IF NOT EXISTS automation_email_deliveries (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  automation_id TEXT NOT NULL,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, automation_id, shift_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_automation_email_deliveries_lookup
  ON automation_email_deliveries (company_id, automation_id, shift_id);
