-- =============================================================================
-- HR System Tech Demo - Full Schema (Phase 1)
-- PostgreSQL — idempotent, safe to re-run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum type
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. companies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. stores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(50) NOT NULL,
  address    TEXT,
  cap        VARCHAR(10),
  max_staff  INTEGER DEFAULT 0,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_stores_company ON stores(company_id);

-- ---------------------------------------------------------------------------
-- 4. users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  store_id          INTEGER REFERENCES stores(id),
  supervisor_id     INTEGER REFERENCES users(id),
  name              VARCHAR(255) NOT NULL,
  surname           VARCHAR(100),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role              user_role NOT NULL,
  unique_id         VARCHAR(100),
  department        VARCHAR(100),
  hire_date         DATE,
  termination_date  DATE,
  contract_end_date DATE,
  working_type      VARCHAR(20) CHECK (working_type IN ('full_time', 'part_time')),
  weekly_hours      NUMERIC(4,1),
  personal_email    VARCHAR(255),
  date_of_birth     DATE,
  nationality       VARCHAR(100),
  gender            VARCHAR(20),
  iban              VARCHAR(34),
  address           TEXT,
  cap               VARCHAR(10),
  first_aid_flag    BOOLEAN DEFAULT false,
  marital_status    VARCHAR(50),
  status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_company_id    ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_store_id      ON users(store_id);
CREATE INDEX IF NOT EXISTS idx_users_supervisor_id ON users(supervisor_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_unique_id_company' AND table_name = 'users'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_unique_id_company UNIQUE (company_id, unique_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. role_module_permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_module_permissions (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  module_name VARCHAR(100) NOT NULL,
  is_enabled  BOOLEAN DEFAULT true,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, role, module_name)
);

-- ---------------------------------------------------------------------------
-- 6. audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  action      VARCHAR(50) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id   BIGINT,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity  ON audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 7. login_attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(255) NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address   VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, attempted_at DESC);

-- ---------------------------------------------------------------------------
-- 8. shifts  (Phase 2 — kept for legacy routes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_company_id ON shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date       ON shifts(date);
-- employee_id only exists on the legacy schema (before migration 003 replaces it with user_id)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shifts' AND column_name='employee_id') THEN
    CREATE INDEX IF NOT EXISTS idx_shifts_employee_id ON shifts(employee_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. attendance  (Phase 2 — kept for legacy routes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id        INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  check_in_time   TIMESTAMPTZ,
  check_out_time  TIMESTAMPTZ,
  qr_token_used   VARCHAR(500),
  status          VARCHAR(20) DEFAULT 'present' CHECK (status IN ('present', 'late', 'absent')),
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_company_id ON attendance(company_id);
CREATE INDEX IF NOT EXISTS idx_attendance_shift_id   ON attendance(shift_id);
CREATE INDEX IF NOT EXISTS idx_attendance_check_in   ON attendance(check_in_time);
-- employee_id only exists on the legacy attendance table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance' AND column_name='employee_id') THEN
    CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance(employee_id);
  END IF;
END $$;
