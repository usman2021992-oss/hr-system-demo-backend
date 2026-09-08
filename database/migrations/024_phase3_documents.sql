-- =============================================================================
-- Migration 024: Phase 3 Documents & E-Signature
-- HR System Tech Demo
-- =============================================================================
-- IDEMPOTENT: Uses IF NOT EXISTS and checks; safe to run multiple times.
-- =============================================================================

-- Document categories
CREATE TABLE IF NOT EXISTS document_categories (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);

-- Employee documents
CREATE TABLE IF NOT EXISTS employee_documents (
  id                  SERIAL PRIMARY KEY,
  company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id         INTEGER REFERENCES document_categories(id) ON DELETE SET NULL,
  file_name           TEXT NOT NULL,
  storage_path        TEXT NOT NULL,
  mime_type           TEXT,
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requires_signature  BOOLEAN NOT NULL DEFAULT FALSE,
  signed_at           TIMESTAMPTZ,
  signed_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  signed_ip           INET,
  signature_meta      JSONB,
  expires_at          TIMESTAMPTZ,
  is_visible_to_roles TEXT[] NOT NULL DEFAULT ARRAY['admin','hr','area_manager','store_manager','employee'],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee
  ON employee_documents (employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_documents_company
  ON employee_documents (company_id);

CREATE INDEX IF NOT EXISTS idx_employee_documents_expires_at
  ON employee_documents (expires_at)
  WHERE expires_at IS NOT NULL;

-- Bulk ZIP uploads for payroll / documents
CREATE TABLE IF NOT EXISTS bulk_document_uploads (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uploaded_by_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name   TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed
  total_files     INTEGER,
  matched_files   INTEGER,
  unmatched_files INTEGER,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual files inside a bulk upload, with match status
CREATE TABLE IF NOT EXISTS bulk_document_files (
  id                    SERIAL PRIMARY KEY,
  bulk_upload_id        INTEGER NOT NULL REFERENCES bulk_document_uploads(id) ON DELETE CASCADE,
  original_file_name    TEXT NOT NULL,
  employee_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  employee_identifier   TEXT, -- parsed from filename (e.g. internal ID or name)
  storage_path          TEXT,
  status                TEXT NOT NULL DEFAULT 'pending', -- pending | matched | unmatched | error
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bulk_document_files_upload
  ON bulk_document_files (bulk_upload_id);
