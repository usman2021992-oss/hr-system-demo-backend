-- Migration to create generated_reports table to archive report executions
CREATE TABLE IF NOT EXISTS generated_reports (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_id VARCHAR(50) NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  size_bytes INT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_date TIMESTAMP WITH TIME ZONE NOT NULL
);
