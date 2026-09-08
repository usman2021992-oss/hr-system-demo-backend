-- =============================================================================
-- Migration 007: Phase 1 Client Feedback
-- Items 1, 5, 6: leave balance visibility, employee new fields, super admin
-- =============================================================================
BEGIN;

-- 1. Company settings: leave balance visibility
ALTER TABLE companies ADD COLUMN IF NOT EXISTS
  show_leave_balance_to_employee BOOLEAN DEFAULT true;

-- 2. Employee new fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_type VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_months INTEGER;

-- 3. Super admin flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;

-- 4. Employee training records
CREATE TABLE IF NOT EXISTS employee_trainings (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  training_type VARCHAR(50) NOT NULL
    CHECK (training_type IN ('product', 'general', 'low_risk_safety', 'fire_safety')),
  start_date    DATE,
  end_date      DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_trainings_user ON employee_trainings(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_trainings_company ON employee_trainings(company_id, end_date);

-- 5. Medical checks
CREATE TABLE IF NOT EXISTS employee_medical_checks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  start_date  DATE,
  end_date    DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_medical_checks_user ON employee_medical_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_medical_checks_company ON employee_medical_checks(company_id, end_date);

-- 6. Grant super admin to demo admin (safe on existing DBs; seed handles fresh DBs)
UPDATE users SET is_super_admin = true WHERE email = 'admin@fusarouomo.com';

COMMIT;
