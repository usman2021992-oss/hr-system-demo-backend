-- =============================================================================
-- Migration 027: Onboarding Module Improvements
-- =============================================================================
-- IDEMPOTENT: Uses ADD COLUMN IF NOT EXISTS; safe to run multiple times.

ALTER TABLE onboarding_templates
  ADD COLUMN IF NOT EXISTS category  VARCHAR(20) NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS due_days  INTEGER,
  ADD COLUMN IF NOT EXISTS link_url  TEXT,
  ADD COLUMN IF NOT EXISTS priority  VARCHAR(10) NOT NULL DEFAULT 'medium';

ALTER TABLE employee_onboarding_tasks
  ADD COLUMN IF NOT EXISTS due_date        DATE,
  ADD COLUMN IF NOT EXISTS completion_note TEXT;
