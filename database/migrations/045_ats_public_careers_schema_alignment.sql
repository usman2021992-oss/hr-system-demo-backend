-- =============================================================================
-- Migration 045: ATS/Public Careers schema alignment
-- =============================================================================
-- Purpose:
-- 1) Align legacy branch databases with ATS columns currently used by service SQL.
-- 2) Keep migration idempotent and safe on reused environments.
-- =============================================================================

CREATE TABLE IF NOT EXISTS job_postings (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id        INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'draft',
  source          TEXT NOT NULL DEFAULT 'internal',
  indeed_post_id  TEXT,
  created_by_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  language        TEXT NOT NULL DEFAULT 'it',
  job_type        TEXT NOT NULL DEFAULT 'fulltime',
  is_remote       BOOLEAN NOT NULL DEFAULT FALSE,
  remote_type     TEXT NOT NULL DEFAULT 'onsite',
  job_city        TEXT,
  job_state       TEXT,
  job_country     TEXT,
  job_postal_code TEXT,
  job_address     TEXT,
  department      TEXT,
  weekly_hours    NUMERIC(5,2),
  contract_type   TEXT,
  salary_min      NUMERIC(12,2),
  salary_max      NUMERIC(12,2),
  salary_period   TEXT,
  experience      TEXT,
  education       TEXT,
  category        TEXT,
  expiration_date DATE,
  published_at    TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_postings_company_status
  ON job_postings (company_id, status);

CREATE TABLE IF NOT EXISTS candidates (
  id                   SERIAL PRIMARY KEY,
  company_id           INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id             INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  job_posting_id       INTEGER REFERENCES job_postings(id) ON DELETE SET NULL,
  full_name            TEXT NOT NULL,
  email                TEXT,
  phone                TEXT,
  cv_path              TEXT,
  resume_path          TEXT,
  linkedin_url         TEXT,
  cover_letter         TEXT,
  tags                 TEXT[] NOT NULL DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'received',
  source               TEXT NOT NULL DEFAULT 'internal',
  source_ref           TEXT,
  gdpr_consent         BOOLEAN NOT NULL DEFAULT FALSE,
  applicant_locale     VARCHAR(10),
  consent_accepted_at  TIMESTAMPTZ,
  applied_at           TIMESTAMPTZ,
  unread               BOOLEAN NOT NULL DEFAULT TRUE,
  last_stage_change    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_company_status
  ON candidates (company_id, status);

CREATE INDEX IF NOT EXISTS idx_candidates_store
  ON candidates (store_id);

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS job_type TEXT,
  ADD COLUMN IF NOT EXISTS is_remote BOOLEAN,
  ADD COLUMN IF NOT EXISTS remote_type TEXT,
  ADD COLUMN IF NOT EXISTS job_city TEXT,
  ADD COLUMN IF NOT EXISTS job_state TEXT,
  ADD COLUMN IF NOT EXISTS job_country TEXT,
  ADD COLUMN IF NOT EXISTS job_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS job_address TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS contract_type TEXT,
  ADD COLUMN IF NOT EXISTS salary_min NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS salary_max NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS salary_period TEXT,
  ADD COLUMN IF NOT EXISTS experience TEXT,
  ADD COLUMN IF NOT EXISTS education TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS expiration_date DATE;

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS cv_path TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_letter TEXT,
  ADD COLUMN IF NOT EXISTS gdpr_consent BOOLEAN,
  ADD COLUMN IF NOT EXISTS applicant_locale VARCHAR(10),
  ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

UPDATE job_postings
SET language = 'it'
WHERE language IS NULL
   OR language NOT IN ('it', 'en', 'both');

UPDATE job_postings
SET job_type = 'fulltime'
WHERE job_type IS NULL
   OR job_type NOT IN ('fulltime', 'parttime', 'contract', 'internship');

UPDATE job_postings
SET remote_type = CASE
  WHEN COALESCE(is_remote, FALSE) THEN 'remote'
  ELSE 'onsite'
END
WHERE remote_type IS NULL
   OR remote_type NOT IN ('onsite', 'hybrid', 'remote');

UPDATE job_postings
SET is_remote = (remote_type = 'remote')
WHERE is_remote IS NULL;

UPDATE job_postings
SET salary_period = NULL
WHERE salary_period IS NOT NULL
  AND salary_period NOT IN (
    'hourly', 'weekly', 'monthly', 'yearly', 'annually',
    'all''ora', 'a settimana', 'al mese', 'per anno'
  );

UPDATE candidates
SET cv_path = resume_path
WHERE cv_path IS NULL
  AND resume_path IS NOT NULL;

UPDATE candidates
SET gdpr_consent = FALSE
WHERE gdpr_consent IS NULL;

UPDATE candidates
SET applied_at = created_at
WHERE applied_at IS NULL;

ALTER TABLE job_postings
  ALTER COLUMN language SET DEFAULT 'it',
  ALTER COLUMN job_type SET DEFAULT 'fulltime',
  ALTER COLUMN is_remote SET DEFAULT FALSE,
  ALTER COLUMN remote_type SET DEFAULT 'onsite';

ALTER TABLE job_postings
  ALTER COLUMN language SET NOT NULL,
  ALTER COLUMN job_type SET NOT NULL,
  ALTER COLUMN is_remote SET NOT NULL,
  ALTER COLUMN remote_type SET NOT NULL;

ALTER TABLE candidates
  ALTER COLUMN gdpr_consent SET DEFAULT FALSE;

ALTER TABLE candidates
  ALTER COLUMN gdpr_consent SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'job_postings_language_chk'
      AND t.relname = 'job_postings'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_language_chk
      CHECK (language IN ('it', 'en', 'both'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'job_postings_job_type_chk'
      AND t.relname = 'job_postings'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_job_type_chk
      CHECK (job_type IN ('fulltime', 'parttime', 'contract', 'internship'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'job_postings_remote_type_chk'
      AND t.relname = 'job_postings'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_remote_type_chk
      CHECK (remote_type IN ('onsite', 'hybrid', 'remote'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'job_postings_salary_range_chk'
      AND t.relname = 'job_postings'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_salary_range_chk
      CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'job_postings_salary_period_chk'
      AND t.relname = 'job_postings'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_salary_period_chk
      CHECK (
        salary_period IS NULL
        OR salary_period IN (
          'hourly', 'weekly', 'monthly', 'yearly', 'annually',
          'all''ora', 'a settimana', 'al mese', 'per anno'
        )
      );
  END IF;
END $$;