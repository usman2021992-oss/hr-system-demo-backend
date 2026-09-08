CREATE TABLE IF NOT EXISTS report_configurations (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_id VARCHAR(50) NOT NULL,
  day INT NOT NULL,
  time VARCHAR(5) NOT NULL, -- HH:MM
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'attivo',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_company_report UNIQUE (company_id, report_id)
);
