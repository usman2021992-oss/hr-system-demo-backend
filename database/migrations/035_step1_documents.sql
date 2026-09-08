-- ---------------------------------------------------------------------------
-- 035_step1_documents.sql
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  file_url    TEXT NOT NULL,
  category    TEXT,
  employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_employee_id ON documents (employee_id);
