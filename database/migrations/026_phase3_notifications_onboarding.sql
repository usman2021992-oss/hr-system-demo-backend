-- =============================================================================
-- Migration 026: Phase 3 Notifications & Onboarding
-- HR System Tech Demo
-- =============================================================================
-- IDEMPOTENT: Uses IF NOT EXISTS and checks; safe to run multiple times.
-- =============================================================================

-- Notification templates (Italian text for various events)
CREATE TABLE IF NOT EXISTS notification_templates (
  id              SERIAL PRIMARY KEY,
  event_key       TEXT NOT NULL UNIQUE, -- e.g. "document.signature_required"
  channel         TEXT NOT NULL,        -- in_app | email
  subject_it      TEXT,
  body_it         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual notifications
CREATE TABLE IF NOT EXISTS notifications (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'medium', -- urgent | high | medium | low
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read, created_at DESC);

-- Onboarding checklist items (per company)
CREATE TABLE IF NOT EXISTS onboarding_templates (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Employee onboarding progress
CREATE TABLE IF NOT EXISTS employee_onboarding_tasks (
  id                    SERIAL PRIMARY KEY,
  employee_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id           INTEGER NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  completed             BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_onboarding_employee
  ON employee_onboarding_tasks (employee_id);

-- =============================================================================
-- Phase 3 Additions: Notification Settings, Automation Settings, Failure Log
-- =============================================================================

-- Admin ON/OFF control per notification event per role
CREATE TABLE IF NOT EXISTS notification_settings (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_key   TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  roles       TEXT[] NOT NULL DEFAULT ARRAY['admin','hr'],
  UNIQUE (company_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_settings_company
  ON notification_settings (company_id, event_key);

-- Admin ON/OFF control per automation cron job
CREATE TABLE IF NOT EXISTS automation_settings (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_key     TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, job_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_settings_company
  ON automation_settings (company_id, job_key);

-- Log of failed email notification attempts (non-blocking failures)
CREATE TABLE IF NOT EXISTS notification_failures (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER,
  user_id     INTEGER,
  event_key   TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_failures_created
  ON notification_failures (created_at DESC);

-- Add soft-delete support to employee_documents
ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_employee_documents_deleted
  ON employee_documents (deleted_at)
  WHERE deleted_at IS NOT NULL;
