CREATE TABLE IF NOT EXISTS company_automations (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  automation_id VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, automation_id)
);
