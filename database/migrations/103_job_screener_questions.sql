-- =============================================================================
-- Migration 103: Screener Questions table
-- =============================================================================

CREATE TABLE IF NOT EXISTS job_screener_questions (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('radio','checkbox','text','number')),
  options JSONB DEFAULT '[]',
  is_knockout BOOLEAN DEFAULT false,
  knockout_value TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_screener_questions_job_company 
  ON job_screener_questions (job_id, company_id);
