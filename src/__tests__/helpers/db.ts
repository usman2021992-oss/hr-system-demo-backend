import { Pool } from 'pg';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/hr_system_test';

export const testPool = new Pool({ connectionString: TEST_DB_URL, options: '-c timezone=UTC' });

function assertSafeTestDatabase(): void {
  // Allow explicit override only when intentionally needed.
  if (process.env.ALLOW_NON_TEST_DATABASE === 'true') return;

  const match = TEST_DB_URL.match(/\/([^/?]+)(?:\?|$)/);
  const dbName = (match?.[1] || '').toLowerCase();

  if (!dbName.includes('test')) {
    throw new Error(
      `Unsafe TEST_DATABASE_URL detected (${TEST_DB_URL}). ` +
      'Refusing to run destructive test setup on a non-test database. ' +
      'Use a *_test database or set ALLOW_NON_TEST_DATABASE=true if intentional.',
    );
  }
}

export async function clearTestData(): Promise<void> {
  assertSafeTestDatabase();
  await testPool.query(`
    TRUNCATE messages, login_attempts, audit_logs, role_module_permissions,
             qr_tokens, attendance_events,
             leave_approvals, leave_balances, leave_requests,
             store_affluence, shift_templates, shifts, temporary_store_assignments,
             window_display_activities,
             attendance, users, stores, companies,
             group_role_visibility, company_groups
    RESTART IDENTITY CASCADE
  `);
}

export async function seedTestData(): Promise<{ acmeId: number; betaId: number; adminId: number; hrId: number; areaManagerId: number; romaManagerId: number; employee1Id: number; terminalId: number; superAdminId: number; romaStoreId: number; shiftId: number; todayShiftId: number }> {
  assertSafeTestDatabase();
  // Ensure group tables/columns exist in the test DB (some CI setups may not have
  // run the newest migrations yet).
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS company_groups (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES company_groups(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_companies_group_id ON companies(group_id);

    CREATE TABLE IF NOT EXISTS group_role_visibility (
      group_id          INTEGER NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
      role              user_role NOT NULL,
      can_cross_company BOOLEAN NOT NULL DEFAULT false,
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_by        INTEGER REFERENCES users(id),
      UNIQUE (group_id, role),
      CHECK (role IN ('hr', 'area_manager'))
    );

    CREATE INDEX IF NOT EXISTS idx_group_role_visibility_group_role ON group_role_visibility(group_id, role);

    CREATE TABLE IF NOT EXISTS temporary_store_assignments (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      origin_store_id     INTEGER NOT NULL REFERENCES stores(id),
      target_store_id     INTEGER NOT NULL REFERENCES stores(id),
      start_date          DATE NOT NULL,
      end_date            DATE NOT NULL,
      status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'cancelled', 'completed')),
      reason              TEXT,
      notes               TEXT,
      created_by          INTEGER REFERENCES users(id),
      cancelled_by        INTEGER REFERENCES users(id),
      cancelled_at        TIMESTAMPTZ,
      cancellation_reason TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),
      CHECK (start_date <= end_date),
      CHECK (origin_store_id <> target_store_id)
    );

    ALTER TABLE shifts
      ADD COLUMN IF NOT EXISTS assignment_id INTEGER REFERENCES temporary_store_assignments(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS window_display_activities (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      date        DATE NOT NULL,
      start_date  DATE,
      end_date    DATE,
      year_month  VARCHAR(7) NOT NULL,
      flagged_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      activity_type VARCHAR(40) NOT NULL DEFAULT 'window_display',
      activity_icon VARCHAR(16),
      custom_activity_name VARCHAR(120),
      duration_hours NUMERIC(4,2),
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT chk_year_month_matches_date CHECK (year_month = TO_CHAR(date, 'YYYY-MM')),
      CONSTRAINT chk_wda_activity_type
        CHECK (activity_type IN (
          'window_display', 'campaign_launch', 'visual_merchandising', 'promo_setup',
          'event_activation', 'seasonal_changeover', 'pop_up_corner', 'store_cleaning',
          'deep_cleaning', 'maintenance_repair', 'decoration_renovation', 'layout_change',
          'store_reset', 'product_restock', 'inventory_count', 'price_update',
          'audit_inspection', 'staff_training', 'custom_activity'
        )),
      CONSTRAINT chk_wda_custom_activity_name
        CHECK (
          (activity_type = 'custom_activity' AND custom_activity_name IS NOT NULL AND BTRIM(custom_activity_name) <> '')
          OR (activity_type <> 'custom_activity' AND custom_activity_name IS NULL)
        ),
      CONSTRAINT chk_wda_duration_hours
        CHECK (duration_hours IS NULL OR (duration_hours >= 0 AND duration_hours <= 24))
    );

    ALTER TABLE window_display_activities
      ADD COLUMN IF NOT EXISTS activity_type VARCHAR(40) NOT NULL DEFAULT 'window_display',
      ADD COLUMN IF NOT EXISTS activity_icon VARCHAR(16),
      ADD COLUMN IF NOT EXISTS custom_activity_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(4,2),
      ADD COLUMN IF NOT EXISTS notes TEXT;

    ALTER TABLE window_display_activities
      DROP CONSTRAINT IF EXISTS chk_wda_activity_type;

    ALTER TABLE window_display_activities
      ADD CONSTRAINT chk_wda_activity_type
        CHECK (activity_type IN (
          'window_display', 'campaign_launch', 'visual_merchandising', 'promo_setup',
          'event_activation', 'seasonal_changeover', 'pop_up_corner', 'store_cleaning',
          'deep_cleaning', 'maintenance_repair', 'decoration_renovation', 'layout_change',
          'store_reset', 'product_restock', 'inventory_count', 'price_update',
          'audit_inspection', 'staff_training', 'custom_activity'
        ));

    ALTER TABLE window_display_activities
      DROP CONSTRAINT IF EXISTS chk_wda_custom_activity_name;

    ALTER TABLE window_display_activities
      ADD CONSTRAINT chk_wda_custom_activity_name
        CHECK (
          (activity_type = 'custom_activity' AND custom_activity_name IS NOT NULL AND BTRIM(custom_activity_name) <> '')
          OR (activity_type <> 'custom_activity' AND custom_activity_name IS NULL)
        );

    ALTER TABLE window_display_activities
      DROP CONSTRAINT IF EXISTS chk_wda_duration_hours;

    ALTER TABLE window_display_activities
      ADD CONSTRAINT chk_wda_duration_hours
        CHECK (duration_hours IS NULL OR (duration_hours >= 0 AND duration_hours <= 24));

    -- Date-range columns (migration 078) + per-date uniqueness (migration 113).
    ALTER TABLE window_display_activities
      ADD COLUMN IF NOT EXISTS start_date DATE,
      ADD COLUMN IF NOT EXISTS end_date DATE;

    UPDATE window_display_activities SET start_date = date WHERE start_date IS NULL;
    UPDATE window_display_activities SET end_date = date WHERE end_date IS NULL;

    ALTER TABLE window_display_activities
      ALTER COLUMN start_date SET NOT NULL,
      ALTER COLUMN end_date SET NOT NULL;

    ALTER TABLE window_display_activities
      DROP CONSTRAINT IF EXISTS chk_wda_date_range;

    ALTER TABLE window_display_activities
      ADD CONSTRAINT chk_wda_date_range CHECK (end_date >= start_date);

    -- Replace the stale per-month restriction with per-date uniqueness.
    ALTER TABLE window_display_activities
      DROP CONSTRAINT IF EXISTS unique_store_month;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_wda_store_start_date'
          AND conrelid = 'window_display_activities'::regclass
      ) THEN
        ALTER TABLE window_display_activities
          ADD CONSTRAINT uq_wda_store_start_date UNIQUE (store_id, start_date);
      END IF;
    END $$;
  `);

  // Ensure companies.is_active exists (used to block operations on deactivated companies).
  await testPool.query(`
    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
  `);

  // off_days column (migration 034 — may not exist in older CI DB setups).
  await testPool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS off_days SMALLINT[] NOT NULL DEFAULT ARRAY[5,6]::SMALLINT[];

    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_off_days_valid_chk;

    ALTER TABLE users
      ADD CONSTRAINT users_off_days_valid_chk
        CHECK (off_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]);

    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_off_days_not_empty_chk;

    ALTER TABLE users
      ADD CONSTRAINT users_off_days_not_empty_chk
        CHECK (cardinality(off_days) >= 1);
  `);

  // Device binding columns (may not exist in older CI DB setups).
  await testPool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS device_reset_pending BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS registered_device_token VARCHAR(128),
      ADD COLUMN IF NOT EXISTS registered_device_identifier VARCHAR(160),
      ADD COLUMN IF NOT EXISTS registered_device_metadata JSONB,
      ADD COLUMN IF NOT EXISTS registered_device_registered_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_seen_ip VARCHAR(45),
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_users_registered_device_token
      ON users(registered_device_token);

    CREATE INDEX IF NOT EXISTS idx_users_registered_device_identifier
      ON users(registered_device_identifier);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_registered_device_identifier_active
      ON users(registered_device_identifier)
      WHERE device_reset_pending = false
        AND registered_device_identifier IS NOT NULL;

    CREATE TABLE IF NOT EXISTS device_events (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      event_type VARCHAR(50) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_device_events_user_time ON device_events(user_id, created_at DESC);
  `);

  // Companies
  const { rows: [acme] } = await testPool.query(
    `INSERT INTO companies (name, slug)
     VALUES ('Acme Test', 'acme-test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const { rows: [beta] } = await testPool.query(
    `INSERT INTO companies (name, slug)
     VALUES ('Beta Test', 'beta-test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );

  // Store
  const { rows: [romaStore] } = await testPool.query(
    `INSERT INTO stores (company_id, name, code, max_staff)
     VALUES ($1, 'Roma Test', 'ROM-T1', 10)
     ON CONFLICT (company_id, code)
     DO UPDATE SET name = EXCLUDED.name, max_staff = EXCLUDED.max_staff
     RETURNING id`,
    [acme.id]
  );

  const HASH = '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG'; // password123

  // Users
  const { rows: [admin] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status)
     VALUES ($1, 'Admin', 'Test', 'admin@acme-test.com', $2, 'admin', 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [hr] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status)
     VALUES ($1, 'HR', 'Test', 'hr@acme-test.com', $2, 'hr', 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [areaManager] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status)
     VALUES ($1, 'Area', 'Manager', 'area@acme-test.com', $2, 'area_manager', 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [romaManager] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, supervisor_id, status)
     VALUES ($1, 'Roma', 'Manager', 'manager.roma@acme-test.com', $2, 'store_manager', $3, $4, 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       store_id = EXCLUDED.store_id,
       supervisor_id = EXCLUDED.supervisor_id,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH, romaStore.id, areaManager.id]
  );
  const { rows: [employee1] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, supervisor_id, department, hire_date, working_type, weekly_hours, unique_id, status)
     VALUES ($1, 'Anna', 'Test', 'employee1@acme-test.com', $2, 'employee', $3, $4, 'Cassa', '2023-01-15', 'full_time', 40, 'ACME-TEST-001', 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       store_id = EXCLUDED.store_id,
       supervisor_id = EXCLUDED.supervisor_id,
       department = EXCLUDED.department,
       hire_date = EXCLUDED.hire_date,
       working_type = EXCLUDED.working_type,
       weekly_hours = EXCLUDED.weekly_hours,
       unique_id = EXCLUDED.unique_id,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH, romaStore.id, romaManager.id]
  );

  const { rows: [terminal] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, status)
     VALUES ($1, 'Terminal', 'Roma', 'terminal@acme-test.com', $2, 'store_terminal', $3, 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       store_id = EXCLUDED.store_id,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH, romaStore.id]
  );

  // Main Admin (is_super_admin) used for global company + permission controls
  const { rows: [superAdmin] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status, is_super_admin)
     VALUES (NULL, 'Super', 'Admin', 'superadmin@acme-test.com', $1, 'admin', 'active', true)
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       is_super_admin = EXCLUDED.is_super_admin
     RETURNING id`,
    [HASH]
  );

  // Seed a single group and assign both companies to it
  const { rows: [grp] } = await testPool.query(
    `INSERT INTO company_groups (name) VALUES ('TEST GROUP')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  await testPool.query(`UPDATE companies SET group_id = $1 WHERE id IN ($2, $3)`, [grp.id, acme.id, beta.id]);
  await testPool.query(
    `INSERT INTO group_role_visibility (group_id, role, can_cross_company)
     VALUES ($1, 'hr', true), ($1, 'area_manager', true)
     ON CONFLICT (group_id, role) DO UPDATE SET can_cross_company = EXCLUDED.can_cross_company`,
    [grp.id]
  );

  // Seed module permissions for both companies
  const modules = ['dipendenti','turni','trasferimenti','presenze','permessi','negozi','messaggi','documenti','ats','report','impostazioni','anomalie'];
  const roles = ['admin','hr','area_manager','store_manager','employee','store_terminal'];
  for (const cid of [acme.id, beta.id]) {
    for (const role of roles) {
      for (const mod of modules) {
        const enabled =
          ['admin', 'hr'].includes(role)
          || (mod === 'dipendenti' && ['area_manager', 'store_manager'].includes(role))
          || (mod === 'turni' && ['area_manager', 'store_manager', 'employee'].includes(role))
          || (mod === 'trasferimenti' && ['area_manager', 'store_manager'].includes(role))
          || (mod === 'presenze' && ['area_manager', 'store_manager', 'employee', 'store_terminal'].includes(role))
          || (mod === 'permessi' && ['area_manager', 'store_manager', 'employee'].includes(role))
          || (mod === 'negozi' && ['area_manager', 'store_manager', 'store_terminal'].includes(role))
          || (mod === 'messaggi' && ['area_manager', 'store_manager', 'employee'].includes(role))
          || (mod === 'impostazioni' && ['area_manager'].includes(role))
          || (mod === 'anomalie' && ['area_manager', 'store_manager'].includes(role));
        await testPool.query(
          `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, role, module_name) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
          [cid, role, mod, enabled]
        );
      }
    }
  }

  // Seed a past shift for employee1 (used by shifts/anomalies tests querying 2026-W11)
  await testPool.query(
    `DELETE FROM shifts
     WHERE company_id = $1 AND user_id = $2 AND (date = '2026-03-10' OR date = CURRENT_DATE)`,
    [acme.id, employee1.id],
  );

  const { rows: [shift1] } = await testPool.query(
    `INSERT INTO shifts (company_id, store_id, user_id, date, start_time, end_time, status, created_by)
     VALUES ($1, $2, $3, '2026-03-10', '09:00', '17:00', 'scheduled', $4) RETURNING id`,
    [acme.id, romaStore.id, employee1.id, admin.id]
  );

  // Seed a today shift for employee1 (used by QR checkin tests)
  const { rows: [todayShift] } = await testPool.query(
    `INSERT INTO shifts (company_id, store_id, user_id, date, start_time, end_time, status, created_by)
     VALUES ($1, $2, $3, CURRENT_DATE, '00:00', '23:59', 'scheduled', $4) RETURNING id`,
    [acme.id, romaStore.id, employee1.id, admin.id]
  );

  return {
    acmeId: acme.id,
    betaId: beta.id,
    adminId: admin.id,
    hrId: hr.id,
    areaManagerId: areaManager.id,
    romaManagerId: romaManager.id,
    employee1Id: employee1.id,
    terminalId: terminal.id,
    superAdminId: superAdmin.id,
    romaStoreId: romaStore.id,
    shiftId: shift1.id,
    todayShiftId: todayShift.id,
  };
}

let poolClosed = false;
export async function closeTestDb(): Promise<void> {
  if (!poolClosed) {
    poolClosed = true;
    await testPool.end();
  }
}
