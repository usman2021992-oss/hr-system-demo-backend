-- =============================================================================
-- Migration 025: Phase 3 ATS & Recruiting
-- HR System Tech Demo
-- =============================================================================
-- IDEMPOTENT: Uses IF NOT EXISTS and checks; safe to run multiple times.
-- =============================================================================

-- Job postings
CREATE TABLE IF NOT EXISTS job_postings (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id        INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'draft', -- draft | published | closed
  source          TEXT NOT NULL DEFAULT 'internal', -- internal | indeed
  indeed_post_id  TEXT,
  created_by_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at    TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_postings_company_status
  ON job_postings (company_id, status);

-- Candidates
CREATE TABLE IF NOT EXISTS candidates (
  id                 SERIAL PRIMARY KEY,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id           INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  job_posting_id     INTEGER REFERENCES job_postings(id) ON DELETE SET NULL,
  full_name          TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  resume_path        TEXT,
  tags               TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'received', -- received | review | interview | hired | rejected
  source             TEXT NOT NULL DEFAULT 'internal', -- internal | indeed
  source_ref         TEXT,
  unread             BOOLEAN NOT NULL DEFAULT TRUE,
  last_stage_change  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_company_status
  ON candidates (company_id, status);

CREATE INDEX IF NOT EXISTS idx_candidates_store
  ON candidates (store_id);

-- Interviews
CREATE TABLE IF NOT EXISTS interviews (
  id                 SERIAL PRIMARY KEY,
  candidate_id       INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  interviewer_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at       TIMESTAMPTZ NOT NULL,
  location           TEXT,
  notes              TEXT,
  ics_uid            TEXT,
  feedback           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interviews_candidate
  ON interviews (candidate_id);

-- Simple jobs-at-risk snapshot table (optional, can be derived but useful for alerts)
CREATE TABLE IF NOT EXISTS job_risk_snapshots (
  id              SERIAL PRIMARY KEY,
  job_posting_id  INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  low_candidates  BOOLEAN NOT NULL DEFAULT FALSE,
  low_compatibility BOOLEAN NOT NULL DEFAULT FALSE,
  no_interviews   BOOLEAN NOT NULL DEFAULT FALSE,
  no_hires        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_job_risk_snapshots_job
  ON job_risk_snapshots (job_posting_id, captured_at DESC);
