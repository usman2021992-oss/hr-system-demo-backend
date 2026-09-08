-- =============================================================================
-- Migration 005: Phase 2 Leave Management
-- HR System Tech Demo
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS leave_requests (
  id                    SERIAL PRIMARY KEY,
  company_id            INTEGER NOT NULL REFERENCES companies(id),
  user_id               INTEGER NOT NULL REFERENCES users(id),
  store_id              INTEGER REFERENCES stores(id),
  leave_type            VARCHAR(20) NOT NULL CHECK (leave_type IN ('vacation','sick')),
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  status                VARCHAR(40) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'supervisor_approved', 'area_manager_approved', 'hr_approved',
      'store manager approved', 'area manager approved', 'HR approved',
      'approved', 'rejected', 'cancelled'
    )),
  current_approver_role VARCHAR(30),
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_company ON leave_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user    ON leave_requests(user_id);

CREATE TABLE IF NOT EXISTS leave_approvals (
  id               SERIAL PRIMARY KEY,
  leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id),
  approver_id      INTEGER NOT NULL REFERENCES users(id),
  approver_role    VARCHAR(30) NOT NULL,
  action           VARCHAR(20) NOT NULL CHECK (action IN ('approved','rejected')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  year        INTEGER NOT NULL,
  leave_type  VARCHAR(20) NOT NULL CHECK (leave_type IN ('vacation','sick')),
  total_days  NUMERIC(5,1) NOT NULL DEFAULT 25,
  used_days   NUMERIC(5,1) NOT NULL DEFAULT 0
    CHECK (used_days >= 0 AND used_days <= total_days),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id, year, leave_type)
);

COMMIT;
