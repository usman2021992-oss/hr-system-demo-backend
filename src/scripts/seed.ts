import { pool } from '../config/database';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ensureSuperAdmin } from './seedUtils';

dotenv.config();

function listMigrationFiles(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// migrate() — apply all SQL migration files (idempotent, safe on every boot)
// Does NOT wipe data. Safe to call on every startup.
// ---------------------------------------------------------------------------
export async function migrate() {
  const client = await pool.connect();
  try {
    // 1. Create migration_history table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Identify migrations directory
    const standaloneDir = path.join(__dirname, '../../database/migrations');
    const monorepoDir = path.join(__dirname, '../../../database/migrations');
    const migrationsDir = fs.existsSync(standaloneDir) ? standaloneDir : monorepoDir;

    // 3. Get applied migrations
    const { rows: applied } = await client.query('SELECT filename FROM migration_history');
    const appliedFiles = new Set(applied.map(r => r.filename));

    // 4. Apply new migrations in order
    for (const file of listMigrationFiles(migrationsDir)) {
      if (appliedFiles.has(file)) {
        continue;
      }
      console.log(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      try {
        await client.query(sql);
        await client.query('INSERT INTO migration_history (filename) VALUES ($1)', [file]);
      } catch (err) {
        console.error(`❌ Migration failed for file ${file}:`, err);
        throw err;
      }
    }
    console.log('✓ Migrations applied (schema up to date)');
  } finally {
    client.release();
  }
}

export async function seed() {
  if (process.env.FORCE_SEED !== 'true') {
    await ensureSuperAdmin();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Drop everything and rebuild schema from scratch ──────────────────────
    // This guarantees a clean slate regardless of what was previously deployed
    // (e.g. old 4-table schema on an existing Railway DB).
    await client.query(`
      DROP TABLE IF EXISTS window_display_activities, messages,
                           store_affluence, shift_templates,
                           leave_balances, leave_approvals, leave_requests,
                           attendance_events, qr_tokens,
                           attendance, shifts, role_module_permissions,
                           audit_logs, login_attempts, users, stores,
                           group_role_visibility, companies, company_groups
      CASCADE
    `);
    await client.query(`DROP TYPE IF EXISTS user_role`);
    console.log('✓ Old schema dropped');

    // Same path resolution as migrate(): try standalone first, fall back to monorepo
    const standaloneDir2 = path.join(__dirname, '../../database/migrations');
    const monorepoDir2 = path.join(__dirname, '../../../database/migrations');
    const migrationsDir = fs.existsSync(standaloneDir2) ? standaloneDir2 : monorepoDir2;
    // Apply all migrations in lexical order (001..N and same-prefix variants).
    for (const file of listMigrationFiles(migrationsDir)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
    }
    console.log('✓ Schema applied');
    console.log('✓ Old data cleared');

    const HASH = '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG'; // password123

    // ── Companies ─────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO companies (name, slug) VALUES
        ('FUSARO UOMO',     'fusaro-uomo'),
        ('Beta Industries', 'beta'),
        ('Paradise Limited', 'paradise-limited')
    `);
    console.log('✓ Companies seeded');

    // ── Company groups (Phase 1 extension) ──────────────────────────────────
    // Demo: put FUSARO UOMO into a group; Beta Industries stays standalone.
    // Role visibility flags decide whether HR/Area Manager can access other
    // companies in the same group (if multiple companies are added later).
    await client.query(`
      INSERT INTO company_groups (name)
      VALUES ('FUSARO GROUP')
      ON CONFLICT (name) DO NOTHING
    `);
    await client.query(`
      UPDATE companies
      SET group_id = (SELECT id FROM company_groups WHERE name = 'FUSARO GROUP')
      WHERE id = 1
    `);
    await client.query(`
      INSERT INTO group_role_visibility (group_id, role, can_cross_company)
      SELECT
        (SELECT id FROM company_groups WHERE name = 'FUSARO GROUP'),
        r.role,
        true
      FROM (VALUES ('hr'::user_role), ('area_manager'::user_role)) AS r(role)
      ON CONFLICT (group_id, role)
      DO UPDATE SET can_cross_company = EXCLUDED.can_cross_company
    `);

    // ── Stores ────────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO stores (company_id, name, code, address, cap, max_staff) VALUES
        (1, 'Negozio Roma Centro',  'ROM-01', 'Via del Corso 100',           '00186', 15),
        (1, 'Negozio Milano Duomo', 'MIL-01', 'Corso Vittorio Emanuele 10', '20122', 12),
        (2, 'Negozio Napoli',       'NAP-01', 'Via Toledo 50',               '80134',  8),
        (3, 'Downtown London Store', 'LDN-01', '221B Baker Street, London',   'NW16XE', 22),
        (3, 'Manchester Central Store', 'MAN-01', '1 St Peter''s Square, Manchester', 'M26AE', 18)
    `);
    console.log('✓ Stores seeded');

    // ── Users — FUSARO UOMO (company_id = 1) ─────────────────────────────────
    await client.query(`
      INSERT INTO users (
        id, company_id, name, surname, email, password_hash,
        role, store_id, supervisor_id,
        department, hire_date, contract_end_date, working_type, weekly_hours,
        status, unique_id,
        personal_email, date_of_birth, nationality, gender,
        iban, address, cap, first_aid_flag, marital_status
      ) VALUES
        (1, 1, 'Marco',     'Rossi',    'admin@fusarouomo.com',         $1, 'admin',         NULL, NULL, 'Direzione',         '2020-01-01', NULL,         NULL,         NULL, 'active', 'FU-ADM-001','marco.rossi.privato@gmail.com',    '1975-03-15', 'Italiana', 'M', 'IT60X0542811101000000112233', 'Via della Conciliazione 45', '00193', true,  'Coniugato'),
        (2, 1, 'Laura',     'Bianchi',  'hr@fusarouomo.com',            $1, 'hr',             NULL, NULL, 'Risorse Umane',     '2020-03-15', NULL,         NULL,         NULL, 'active', 'FU-HR-001', 'laura.bianchi.hr@gmail.com',       '1982-07-22', 'Italiana', 'F', 'IT60X0542811101000000223344', 'Via Nazionale 12',           '00184', false, 'Nubile'),
        (3, 1, 'Giuseppe',  'Ferrari',  'areamanager@fusarouomo.com',   $1, 'area_manager',  NULL, NULL, 'Operations',        '2019-06-01', NULL,         NULL,         NULL, 'active', 'FU-AM-001', 'g.ferrari.privato@libero.it',      '1978-11-05', 'Italiana', 'M', 'IT60X0542811101000000334455', 'Piazza Venezia 3',           '00186', true,  'Coniugato'),
        (4, 1, 'Sofia',     'Esposito', 'manager.roma@fusarouomo.com',  $1, 'store_manager', 1,    3,    'Gestione Negozio',  '2021-02-10', NULL,         NULL,         NULL, 'active', 'FU-SM-001', 'sofia.esposito@gmail.com',         '1985-04-18', 'Italiana', 'F', 'IT60X0542811101000000445566', 'Via del Corso 88',           '00186', false, 'Nubile'),
        (5, 1, 'Luca',      'Ricci',    'manager.milano@fusarouomo.com',$1, 'store_manager', 2,    3,    'Gestione Negozio',  '2021-04-20', NULL,         NULL,         NULL, 'active', 'FU-SM-002', 'luca.ricci.mi@gmail.com',          '1983-09-30', 'Italiana', 'M', 'IT60X0542811101000000556677', 'Via Montenapoleone 5',       '20121', true,  'Coniugato'),
        (6, 1, 'Anna',      'Conti',    'dipendente1@fusarouomo.com',   $1, 'employee',      1,    4,    'Cassa',             '2026-03-05', NULL,         'full_time',  40,   'active', 'FU-EMP-001','anna.conti.privata@gmail.com',     '1995-02-14', 'Italiana', 'F', 'IT60X0542811101000000667788', 'Via Tiburtina 200',          '00162', true,  'Nubile'),
        (7, 1, 'Roberto',   'Mancini',  'dipendente2@fusarouomo.com',   $1, 'employee',      1,    4,    'Magazzino',         '2026-01-15', '2026-12-31', 'part_time',  20,   'active', 'FU-EMP-002','roberto.mancini99@gmail.com',      '1998-08-20', 'Italiana', 'M', 'IT60X0542811101000000778899', 'Via Prenestina 55',          '00176', false, 'Celibe'),
        (8, 1, 'Chiara',    'Lombardi', 'dipendente3@fusarouomo.com',   $1, 'employee',      2,    5,    'Cassa',             '2025-11-20', NULL,         'full_time',  40,   'active', 'FU-EMP-003','chiara.lombardi.mi@gmail.com',     '1996-05-07', 'Italiana', 'F', 'IT60X0542811101000000889900', 'Corso Buenos Aires 60',      '20124', false, 'Nubile'),
        (9, 1, 'Terminale', 'Roma',     'terminal.roma@fusarouomo.com', $1, 'store_terminal',1,    NULL, NULL,                '2024-01-01', NULL,         NULL,         NULL, 'active', 'FU-TERM-01',NULL,                               NULL,         NULL,       NULL,NULL,                         NULL,                         NULL,    false, NULL)
    `, [HASH]);

    // ── Users — Beta Industries (company_id = 2) ──────────────────────────────
    await client.query(`
      INSERT INTO users (
        id, company_id, name, surname, email, password_hash,
        role, store_id, supervisor_id,
        department, hire_date, contract_end_date, working_type, weekly_hours,
        status, unique_id,
        personal_email, date_of_birth, nationality, gender,
        iban, address, cap, first_aid_flag, marital_status
      ) VALUES
        (10, 2, 'Giulia',   'De Luca', 'hr@beta.com',      $1, 'hr',             NULL, NULL, 'Risorse Umane',    '2021-01-10', NULL,         NULL,        NULL, 'active', 'BE-HR-001', 'giulia.deluca.privata@gmail.com',   '1980-12-03', 'Italiana', 'F', 'IT60X0542811101000000990011', 'Via Toledo 30',      '80134', false, 'Coniugata'),
        (11, 2, 'Antonio',  'Marino',  'manager@beta.com', $1, 'store_manager',  3,    NULL, 'Gestione Negozio', '2020-09-15', NULL,         NULL,        NULL, 'active', 'BE-SM-001', 'antonio.marino.na@libero.it',       '1977-06-25', 'Italiana', 'M', 'IT60X0542811101000001001122', 'Via Caracciolo 14',  '80122', true,  'Coniugato'),
        (12, 2, 'Carol',    'Russo',   'carol@beta.com',   $1, 'employee',       3,    11,   'Vendite',          '2026-03-10', NULL,         'full_time', 40,   'active', 'BE-EMP-001','carol.russo.privata@gmail.com',     '1992-10-11', 'Italiana', 'F', 'IT60X0542811101000001112233', 'Via Chiaia 55',      '80121', false, 'Nubile'),
        (13, 2, 'Marco',    'Bruno',   'marco@beta.com',   $1, 'employee',       3,    11,   'Cassa',            '2025-12-05', '2026-09-30', 'part_time', 24,   'active', 'BE-EMP-002','marco.bruno2000@gmail.com',         '2000-01-30', 'Italiana', 'M', 'IT60X0542811101000001223344', 'Via Mergellina 8',   '80122', false, 'Celibe')
    `, [HASH]);

    // We inserted explicit `id` values above; `SERIAL`'s sequence is not
    // automatically advanced for explicit inserts. Advance it for any subsequent inserts.
    await client.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))`);
    console.log('✓ Users seeded (13 users)');

    // ── Phase 1 feedback: contract_type + probation_months for employees ──────
    await client.query(`
      UPDATE users SET contract_type = 'Tempo Indeterminato', probation_months = NULL
        WHERE id = 6;  -- Anna: confirmed permanent
      UPDATE users SET contract_type = 'Tempo Determinato',  probation_months = 3
        WHERE id = 7;  -- Roberto: fixed-term with 3-month probation
      UPDATE users SET contract_type = 'Tempo Indeterminato', probation_months = 6
        WHERE id = 8;  -- Chiara: permanent, past probation (6 months)
      UPDATE users SET contract_type = 'Tempo Indeterminato', probation_months = NULL
        WHERE id = 12; -- Carol: permanent
      UPDATE users SET contract_type = 'Tempo Determinato',  probation_months = 3
        WHERE id = 13; -- Marco B.: fixed-term with probation
    `);
    console.log('✓ Contract type / probation seeded');

    // ── Phase 1 feedback: employee_trainings ─────────────────────────────────
    // Four training types per employee (product, general, low_risk_safety, fire_safety)
    // Employees: Anna(6,c1), Roberto(7,c1), Chiara(8,c1), Carol(12,c2), Marco B.(13,c2)
    await client.query(`
      INSERT INTO employee_trainings (user_id, company_id, training_type, start_date, end_date, notes) VALUES
        -- Anna (6)
        (6, 1, 'product',          '2026-01-10', '2026-01-10', 'Formazione prodotti collezione primavera'),
        (6, 1, 'general',          '2026-01-15', '2026-01-16', 'Orientamento aziendale e procedure interne'),
        (6, 1, 'low_risk_safety',  '2026-02-05', '2026-02-05', 'Sicurezza rischio basso'),
        (6, 1, 'fire_safety',      '2026-02-20', '2026-02-20', 'Antincendio base'),
        -- Roberto (7)
        (7, 1, 'product',          '2026-01-20', '2026-01-20', 'Formazione prodotti nuova stagione'),
        (7, 1, 'general',          '2026-01-22', '2026-01-23', 'Orientamento e regolamento aziendale'),
        (7, 1, 'low_risk_safety',  '2026-02-10', '2026-02-10', 'Sicurezza rischio basso'),
        (7, 1, 'fire_safety',      '2026-03-01', '2026-03-01', 'Antincendio base'),
        -- Chiara (8)
        (8, 1, 'product',          '2025-11-25', '2025-11-25', 'Formazione prodotti autunno/inverno'),
        (8, 1, 'general',          '2025-11-28', '2025-11-29', 'Procedure interne Milano'),
        (8, 1, 'low_risk_safety',  '2025-12-10', '2025-12-10', 'Sicurezza rischio basso'),
        (8, 1, 'fire_safety',      '2026-01-08', '2026-01-08', 'Antincendio base'),
        -- Carol (12)
        (12, 2, 'product',         '2026-03-12', '2026-03-12', 'Formazione prodotti'),
        (12, 2, 'general',         '2026-03-13', '2026-03-14', 'Orientamento aziendale'),
        (12, 2, 'low_risk_safety', '2026-03-15', '2026-03-15', 'Sicurezza rischio basso'),
        (12, 2, 'fire_safety',     '2026-03-15', '2026-03-15', 'Antincendio base'),
        -- Marco B. (13)
        (13, 2, 'product',         '2025-12-08', '2025-12-08', 'Formazione prodotti'),
        (13, 2, 'general',         '2025-12-10', '2025-12-11', 'Orientamento e procedure'),
        (13, 2, 'low_risk_safety', '2025-12-15', '2025-12-15', 'Sicurezza rischio basso'),
        (13, 2, 'fire_safety',     '2026-01-12', '2026-01-12', 'Antincendio base')
    `);
    console.log('✓ Employee trainings seeded (20 records)');

    // ── Phase 1 feedback: employee_medical_checks ─────────────────────────────
    await client.query(`
      INSERT INTO employee_medical_checks (user_id, company_id, start_date, end_date, notes) VALUES
        (6,  1, '2026-01-08', '2026-01-08', 'Visita medica di assunzione — idoneità confermata'),
        (7,  1, '2026-01-20', '2026-01-20', 'Visita medica di assunzione — idoneità confermata'),
        (8,  1, '2025-11-22', '2025-11-22', 'Visita medica periodica — idoneità confermata'),
        (8,  1, '2024-11-18', '2024-11-18', 'Visita medica periodica annuale'),
        (12, 2, '2026-03-11', '2026-03-11', 'Visita medica di assunzione — idoneità confermata'),
        (13, 2, '2025-12-06', '2025-12-06', 'Visita medica di assunzione — idoneità confermata')
    `);
    console.log('✓ Employee medical checks seeded (6 records)');

    // ── role_module_permissions ───────────────────────────────────────────────
    const modules = ['dipendenti', 'turni', 'trasferimenti', 'presenze', 'permessi', 'documenti', 'ats', 'report', 'impostazioni'];
    const roles = ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'];
    const companies = [1, 2, 3];

    for (const cid of companies) {
      for (const role of roles) {
        for (const mod of modules) {
          const enabled =
            (mod === 'dipendenti' && ['admin', 'hr', 'area_manager', 'store_manager'].includes(role)) ||
            (mod === 'turni' && ['admin', 'hr', 'area_manager', 'store_manager'].includes(role)) ||
            (mod === 'trasferimenti' && ['admin', 'hr', 'area_manager', 'store_manager'].includes(role)) ||
            (mod === 'presenze' && ['admin', 'hr', 'area_manager', 'store_manager'].includes(role)) ||
            (mod === 'permessi' && ['admin', 'hr', 'area_manager', 'store_manager'].includes(role)) ||
            (mod === 'impostazioni' && ['admin', 'hr'].includes(role));
          await client.query(
            `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [cid, role, mod, enabled]
          );
        }
      }
    }
    console.log('✓ Permissions seeded');

    // Enable Phase 2 modules for all companies
    for (const cid of companies) {
      await client.query(`
        INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
        VALUES
          ($1, 'admin',         'turni',    true),
          ($1, 'hr',            'turni',    true),
          ($1, 'area_manager',  'turni',    true),
          ($1, 'store_manager', 'turni',    true),
          ($1, 'employee',      'turni',    true),
          ($1, 'admin',         'trasferimenti', true),
          ($1, 'hr',            'trasferimenti', true),
          ($1, 'area_manager',  'trasferimenti', true),
          ($1, 'store_manager', 'trasferimenti', true),
          ($1, 'admin',         'presenze', true),
          ($1, 'hr',            'presenze', true),
          ($1, 'area_manager',  'presenze', true),
          ($1, 'store_manager', 'presenze', true),
          ($1, 'store_terminal','presenze', true),
          ($1, 'employee',      'presenze', true),
          ($1, 'admin',         'permessi', true),
          ($1, 'hr',            'permessi', true),
          ($1, 'area_manager',  'permessi', true),
          ($1, 'store_manager', 'permessi', true),
          ($1, 'employee',      'permessi', true)
        ON CONFLICT (company_id, role, module_name) DO UPDATE SET is_enabled = true
      `, [cid]);
    }
    console.log('✓ Phase 2 permissions enabled');

    // Seed leave balances for all employees
    for (const cid of companies) {
      await client.query(`
        INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
        SELECT company_id, id, EXTRACT(YEAR FROM NOW())::int, 'vacation', 25, 0
        FROM users
        WHERE company_id = $1 AND role = 'employee' AND status = 'active'
        ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING
      `, [cid]);

      await client.query(`
        INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
        SELECT company_id, id, EXTRACT(YEAR FROM NOW())::int, 'sick', 10, 0
        FROM users
        WHERE company_id = $1 AND role = 'employee' AND status = 'active'
        ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING
      `, [cid]);
    }
    console.log('✓ Leave balances seeded');

    // ── Leave requests — realistic demo data ─────────────────────────────────
    // Users: Anna=6 (Roma), Roberto=7 (Roma), Chiara=8 (Milano)
    //        Carol=12 (Napoli/Beta), Marco B.=13 (Napoli/Beta)
    // Statuses: hr_approved (shows on calendar), supervisor_approved (in-flow),
    //           pending, rejected — cover W11/W12/W13 + W14

    // Insert leave requests
    const { rows: lrRows } = await client.query(`
      INSERT INTO leave_requests
        (company_id, user_id, store_id, leave_type, start_date, end_date, status, current_approver_role, notes)
      VALUES
        -- Anna (6): approved vacation W12 — shows on shift calendar
        (1, 6, 1, 'vacation', '2026-03-18', '2026-03-20', 'HR approved',              NULL,             'Ferie primaverili'),
        -- Roberto (7): approved sick W11 — shows on shift calendar
        (1, 7, 1, 'sick',     '2026-03-10', '2026-03-10', 'HR approved',              NULL,             'Influenza'),
        -- Anna (6): pending vacation W14 — shows as (att.) badge
        (1, 6, 1, 'vacation', '2026-03-30', '2026-04-03', 'pending',                  'store_manager',  NULL),
        -- Chiara (8): supervisor-approved vacation W13 — in approval chain
        (1, 8, 2, 'vacation', '2026-03-24', '2026-03-26', 'store manager approved',    'area_manager',   'Vacanza breve'),
        -- Roberto (7): approved vacation W13 — shows on shift calendar
        (1, 7, 1, 'vacation', '2026-03-23', '2026-03-24', 'HR approved',              NULL,             NULL),
        -- Carol (12): approved sick — Beta company
        (2, 12, 3,'sick',     '2026-03-11', '2026-03-12', 'HR approved',              NULL,             'Certificato medico allegato'),
        -- Marco B. (13): pending vacation — Beta company
        (2, 13, 3,'vacation', '2026-03-25', '2026-03-27', 'pending',                  'store_manager',  NULL),
        -- Anna (6): area_manager_approved vacation W15 — waiting for HR final step
        (1, 6, 1, 'vacation', '2026-04-07', '2026-04-11', 'area manager approved',    'hr',             'Pasqua'),
        -- Roberto (7): supervisor_approved sick W14 — waiting for area_manager
        (1, 7, 1, 'sick',     '2026-04-01', '2026-04-02', 'store manager approved',    'area_manager',   NULL),
        -- Chiara (8): rejected vacation — shows rejected state
        (1, 8, 2, 'vacation', '2026-04-14', '2026-04-18', 'rejected',                 NULL,             'Ponte aprile'),
        -- Chiara (8): new pending vacation W16 after rejection
        (1, 8, 2, 'vacation', '2026-04-21', '2026-04-25', 'pending',                  'store_manager',  'Richiesta alternativa')
      RETURNING id, user_id, leave_type, start_date, end_date, status
    `);

    // Insert approval records for approved/in-flow/rejected requests
    for (const lr of lrRows) {
      if (['store manager approved', 'area manager approved', 'HR approved', 'rejected'].includes(lr.status)) {
        // Step 1: store_manager approval (users: Sofia=4 for Roma, Luca=5 for Milano, Antonio=11 for Beta)
        const smId = (lr.user_id === 12 || lr.user_id === 13) ? 11 : (lr.user_id === 8 ? 5 : 4);
        await client.query(`
          INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
          VALUES ($1, $2, 'store_manager', 'approved', NULL)
        `, [lr.id, smId]);
      }
      if (['area manager approved', 'HR approved', 'rejected'].includes(lr.status)) {
        // Step 2: area_manager approval (Giuseppe=3 for company 1)
        await client.query(`
          INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
          VALUES ($1, 3, 'area_manager', 'approved', NULL)
        `, [lr.id]);
      }
      if (lr.status === 'HR approved') {
        // Step 3: hr approval (Laura=2 for company 1, Giulia=10 for company 2)
        const hrId = (lr.user_id === 12 || lr.user_id === 13) ? 10 : 2;
        await client.query(`
          INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
          VALUES ($1, $2, 'hr', 'approved', NULL)
        `, [lr.id, hrId]);
      }
      if (lr.status === 'rejected') {
        // Rejection step by hr (Laura=2 for company 1)
        await client.query(`
          INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
          VALUES ($1, 2, 'hr', 'rejected', 'Periodo non compatibile con le esigenze aziendali')
        `, [lr.id]);
      }
    }

    // Update leave_balances used_days for HR approved requests
    const approvedReqs = lrRows.filter(r => r.status === 'HR approved');
    for (const lr of approvedReqs) {
      const days = Math.ceil(
        (new Date(lr.end_date).getTime() - new Date(lr.start_date).getTime()) / 86400000
      ) + 1;
      await client.query(`
        UPDATE leave_balances
        SET used_days = LEAST(used_days + $1, total_days), updated_at = NOW()
        WHERE company_id = (SELECT company_id FROM users WHERE id = $2)
          AND user_id = $2 AND year = 2026 AND leave_type = $3
      `, [days, lr.user_id, lr.leave_type]);
    }

    console.log(`✓ Leave requests seeded (${lrRows.length} requests)`);

    // Seed store affluence (default patterns for all stores)
    const { rows: storeRows } = await client.query(
      `SELECT id, company_id FROM stores WHERE is_active = true`
    );
    for (const store of storeRows) {
      await client.query(`DELETE FROM store_affluence WHERE store_id = $1`, [store.id]);
      await client.query(`
        INSERT INTO store_affluence (company_id, store_id, iso_week, day_of_week, time_slot, level, required_staff)
        SELECT $1, $2, NULL, dow, slot,
          CASE WHEN dow IN (6,7) THEN 'high'
               WHEN slot IN ('12:00-15:00', '15:00-18:00') THEN 'medium'
               ELSE 'low' END,
          CASE WHEN dow IN (6,7) THEN 3
               WHEN slot IN ('12:00-15:00', '15:00-18:00') THEN 2
               ELSE 1 END
        FROM (VALUES (1),(2),(3),(4),(5),(6),(7)) AS days(dow)
        CROSS JOIN (VALUES ('09:00-12:00'),('12:00-15:00'),('15:00-18:00'),('18:00-21:00')) AS slots(slot)
      `, [store.company_id, store.id]);
    }

    // Week-specific demo affluence for Paradise Limited flagship stores
    const { rows: paradiseStores } = await client.query<{
      id: number;
      company_id: number;
      name: string;
    }>(`
      SELECT s.id, s.company_id, s.name
      FROM stores s
      JOIN companies c ON c.id = s.company_id
      WHERE c.slug = 'paradise-limited'
        AND s.name IN ('Downtown London Store', 'Manchester Central Store')
    `);

    const paradiseSlots = [
      { day: 1, slot: '09:00-12:00', level: 'medium' as const, london: 4, manchester: 3 },
      { day: 1, slot: '12:00-15:00', level: 'high' as const, london: 6, manchester: 5 },
      { day: 1, slot: '15:00-18:00', level: 'high' as const, london: 7, manchester: 6 },
      { day: 1, slot: '18:00-21:00', level: 'medium' as const, london: 5, manchester: 4 },
      { day: 5, slot: '09:00-12:00', level: 'medium' as const, london: 5, manchester: 4 },
      { day: 5, slot: '12:00-15:00', level: 'high' as const, london: 8, manchester: 7 },
      { day: 5, slot: '15:00-18:00', level: 'high' as const, london: 9, manchester: 8 },
      { day: 5, slot: '18:00-21:00', level: 'high' as const, london: 7, manchester: 6 },
      { day: 6, slot: '09:00-12:00', level: 'high' as const, london: 8, manchester: 7 },
      { day: 6, slot: '12:00-15:00', level: 'high' as const, london: 10, manchester: 9 },
      { day: 6, slot: '15:00-18:00', level: 'high' as const, london: 11, manchester: 10 },
      { day: 6, slot: '18:00-21:00', level: 'high' as const, london: 9, manchester: 8 },
      { day: 7, slot: '09:00-12:00', level: 'medium' as const, london: 6, manchester: 5 },
      { day: 7, slot: '12:00-15:00', level: 'high' as const, london: 8, manchester: 7 },
      { day: 7, slot: '15:00-18:00', level: 'high' as const, london: 9, manchester: 8 },
      { day: 7, slot: '18:00-21:00', level: 'medium' as const, london: 6, manchester: 5 },
    ];

    for (const store of paradiseStores) {
      const isLondon = store.name === 'Downtown London Store';
      for (const slot of paradiseSlots) {
        await client.query(
          `INSERT INTO store_affluence (company_id, store_id, iso_week, day_of_week, time_slot, level, required_staff)
           VALUES ($1, $2, 14, $3, $4, $5, $6)`,
          [
            store.company_id,
            store.id,
            slot.day,
            slot.slot,
            slot.level,
            isLondon ? slot.london : slot.manchester,
          ],
        );
      }
    }
    console.log('✓ Store affluence seeded');

    // ── Shifts — 3 weeks of realistic data ──────────────────────────────────
    // W11 (2026-03-09 to 2026-03-15) — confirmed (past)
    // W12 (2026-03-16 to 2026-03-22) — mix confirmed/scheduled (current)
    // W13 (2026-03-23 to 2026-03-29) — scheduled (future)
    await client.query(`
      INSERT INTO shifts (company_id, store_id, user_id, date, start_time, end_time, break_start, break_end, is_split, status, notes, created_by)
      VALUES
        -- W11 Roma (store 1): Sofia (4), Anna (6), Roberto (7)
        (1,1,4,'2026-03-09','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,1,6,'2026-03-09','08:00','14:00','12:00','12:30',false,'confirmed',NULL,1),
        (1,1,7,'2026-03-09','09:00','14:00',NULL,NULL,false,'confirmed',NULL,1),
        (1,1,4,'2026-03-10','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,1,6,'2026-03-10','14:00','20:00','17:00','17:30',false,'confirmed',NULL,1),
        (1,1,7,'2026-03-10','09:00','14:00',NULL,NULL,false,'confirmed',NULL,1),
        (1,1,4,'2026-03-11','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,1,6,'2026-03-11','08:00','14:00','12:00','12:30',false,'confirmed',NULL,1),
        (1,1,7,'2026-03-11','09:00','14:00',NULL,NULL,false,'confirmed',NULL,1),
        (1,1,4,'2026-03-12','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,1,6,'2026-03-12','14:00','20:00','17:00','17:30',false,'confirmed',NULL,1),
        (1,1,4,'2026-03-13','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,1,6,'2026-03-13','08:00','14:00','12:00','12:30',false,'confirmed',NULL,1),
        (1,1,6,'2026-03-15','10:00','18:00','13:00','14:00',false,'confirmed','Weekend rinforzo',1),

        -- W11 Milano (store 2): Luca (5), Chiara (8)
        (1,2,5,'2026-03-09','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,8,'2026-03-09','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,5,'2026-03-10','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,8,'2026-03-10','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,5,'2026-03-11','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,8,'2026-03-11','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,5,'2026-03-12','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,8,'2026-03-12','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,5,'2026-03-13','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,8,'2026-03-13','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),

        -- W12 Roma (current week) — mix of confirmed + scheduled
        (1,1,4,'2026-03-16','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,1,6,'2026-03-16','08:00','14:00','12:00','12:30',false,'confirmed',NULL,1),
        (1,1,7,'2026-03-16','09:00','14:00',NULL,NULL,false,'confirmed',NULL,1),
        (1,1,4,'2026-03-17','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,1,6,'2026-03-17','14:00','20:00','17:00','17:30',false,'confirmed',NULL,1),
        (1,1,7,'2026-03-17','09:00','14:00',NULL,NULL,false,'confirmed',NULL,1),
        (1,1,4,'2026-03-18','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-18','08:00','14:00','12:00','12:30',false,'scheduled',NULL,1),
        (1,1,7,'2026-03-18','09:00','14:00',NULL,NULL,false,'scheduled',NULL,1),
        (1,1,4,'2026-03-19','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-19','14:00','20:00','17:00','17:30',false,'scheduled',NULL,1),
        (1,1,4,'2026-03-20','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-20','08:00','14:00','12:00','12:30',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-21','10:00','18:00','13:00','14:00',false,'scheduled','Sabato rinforzo',1),
        (1,1,7,'2026-03-21','10:00','15:00',NULL,NULL,false,'scheduled',NULL,1),

        -- W12 Milano (current week)
        (1,2,5,'2026-03-16','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,8,'2026-03-16','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,5,'2026-03-17','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,8,'2026-03-17','09:00','18:00','13:00','14:00',false,'confirmed',NULL,1),
        (1,2,5,'2026-03-18','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,8,'2026-03-18','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,5,'2026-03-19','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,8,'2026-03-19','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,5,'2026-03-20','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,8,'2026-03-20','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),

        -- W13 Roma (next week) — all scheduled
        (1,1,4,'2026-03-23','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-23','08:00','14:00','12:00','12:30',false,'scheduled',NULL,1),
        (1,1,7,'2026-03-23','09:00','14:00',NULL,NULL,false,'scheduled',NULL,1),
        (1,1,4,'2026-03-24','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-24','14:00','20:00','17:00','17:30',false,'scheduled',NULL,1),
        (1,1,7,'2026-03-24','09:00','14:00',NULL,NULL,false,'scheduled',NULL,1),
        (1,1,4,'2026-03-25','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-25','08:00','14:00','12:00','12:30',false,'scheduled',NULL,1),
        (1,1,4,'2026-03-26','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-26','14:00','20:00','17:00','17:30',false,'scheduled',NULL,1),
        (1,1,7,'2026-03-26','09:00','14:00',NULL,NULL,false,'scheduled',NULL,1),
        (1,1,4,'2026-03-27','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,1,6,'2026-03-27','08:00','14:00','12:00','12:30',false,'scheduled',NULL,1),

        -- W13 Milano (next week)
        (1,2,5,'2026-03-23','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,8,'2026-03-23','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,5,'2026-03-24','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,8,'2026-03-24','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,5,'2026-03-25','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,8,'2026-03-25','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,5,'2026-03-26','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,8,'2026-03-26','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,5,'2026-03-27','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),
        (1,2,8,'2026-03-27','09:00','18:00','13:00','14:00',false,'scheduled',NULL,1),

        -- Beta Industries Napoli (store 3): Carol (12), Marco (13)
        (2,3,11,'2026-03-16','09:00','18:00','13:00','14:00',false,'confirmed',NULL,10),
        (2,3,12,'2026-03-16','09:00','18:00','13:00','14:00',false,'confirmed',NULL,10),
        (2,3,13,'2026-03-16','09:00','14:00',NULL,NULL,false,'confirmed',NULL,10),
        (2,3,11,'2026-03-17','09:00','18:00','13:00','14:00',false,'confirmed',NULL,10),
        (2,3,12,'2026-03-17','14:00','20:00','17:00','17:30',false,'confirmed',NULL,10),
        (2,3,13,'2026-03-17','09:00','14:00',NULL,NULL,false,'scheduled',NULL,10),
        (2,3,11,'2026-03-18','09:00','18:00','13:00','14:00',false,'scheduled',NULL,10),
        (2,3,12,'2026-03-18','09:00','18:00','13:00','14:00',false,'scheduled',NULL,10),
        (2,3,11,'2026-03-19','09:00','18:00','13:00','14:00',false,'scheduled',NULL,10),
        (2,3,12,'2026-03-19','14:00','20:00','17:00','17:30',false,'scheduled',NULL,10),
        (2,3,13,'2026-03-19','09:00','14:00',NULL,NULL,false,'scheduled',NULL,10),
        (2,3,11,'2026-03-20','09:00','18:00','13:00','14:00',false,'scheduled',NULL,10),
        (2,3,12,'2026-03-20','09:00','18:00','13:00','14:00',false,'scheduled',NULL,10)
    `);
    console.log('✓ Shifts seeded (3 weeks)');

    // ── Attendance events — realistic check-in/out for W11 + W12 confirmed ──
    // Source: 'manual' (no QR tokens needed for seed). shift_id=NULL for simplicity.
    await client.query(`
      INSERT INTO attendance_events (company_id, store_id, user_id, event_type, event_time, source)
      VALUES
        -- 2026-03-09 Monday — Roma: Sofia(4) full day, Anna(6) morning, Roberto(7) morning
        (1,1,4,'checkin',    '2026-03-09 09:02:00+00','manual'),
        (1,1,4,'break_start','2026-03-09 13:01:00+00','manual'),
        (1,1,4,'break_end',  '2026-03-09 14:03:00+00','manual'),
        (1,1,4,'checkout',   '2026-03-09 18:05:00+00','manual'),
        (1,1,6,'checkin',    '2026-03-09 08:01:00+00','manual'),
        (1,1,6,'break_start','2026-03-09 12:00:00+00','manual'),
        (1,1,6,'break_end',  '2026-03-09 12:32:00+00','manual'),
        (1,1,6,'checkout',   '2026-03-09 14:02:00+00','manual'),
        (1,1,7,'checkin',    '2026-03-09 09:08:00+00','manual'),
        (1,1,7,'checkout',   '2026-03-09 14:04:00+00','manual'),
        -- 2026-03-09 Monday — Milano: Luca(5), Chiara(8)
        (1,2,5,'checkin',    '2026-03-09 09:00:00+00','manual'),
        (1,2,5,'break_start','2026-03-09 13:00:00+00','manual'),
        (1,2,5,'break_end',  '2026-03-09 14:01:00+00','manual'),
        (1,2,5,'checkout',   '2026-03-09 18:02:00+00','manual'),
        (1,2,8,'checkin',    '2026-03-09 09:05:00+00','manual'),
        (1,2,8,'break_start','2026-03-09 13:02:00+00','manual'),
        (1,2,8,'break_end',  '2026-03-09 14:00:00+00','manual'),
        (1,2,8,'checkout',   '2026-03-09 17:58:00+00','manual'),

        -- 2026-03-10 Tuesday — Roma
        (1,1,4,'checkin',    '2026-03-10 09:01:00+00','manual'),
        (1,1,4,'break_start','2026-03-10 13:00:00+00','manual'),
        (1,1,4,'break_end',  '2026-03-10 14:00:00+00','manual'),
        (1,1,4,'checkout',   '2026-03-10 18:03:00+00','manual'),
        (1,1,6,'checkin',    '2026-03-10 14:02:00+00','manual'),
        (1,1,6,'break_start','2026-03-10 17:01:00+00','manual'),
        (1,1,6,'break_end',  '2026-03-10 17:32:00+00','manual'),
        (1,1,6,'checkout',   '2026-03-10 20:01:00+00','manual'),
        (1,1,7,'checkin',    '2026-03-10 09:00:00+00','manual'),
        (1,1,7,'checkout',   '2026-03-10 14:02:00+00','manual'),
        -- Milano
        (1,2,5,'checkin',    '2026-03-10 09:02:00+00','manual'),
        (1,2,5,'break_start','2026-03-10 13:00:00+00','manual'),
        (1,2,5,'break_end',  '2026-03-10 14:00:00+00','manual'),
        (1,2,5,'checkout',   '2026-03-10 18:01:00+00','manual'),
        (1,2,8,'checkin',    '2026-03-10 09:04:00+00','manual'),
        (1,2,8,'break_start','2026-03-10 13:01:00+00','manual'),
        (1,2,8,'break_end',  '2026-03-10 14:02:00+00','manual'),
        (1,2,8,'checkout',   '2026-03-10 18:00:00+00','manual'),

        -- 2026-03-11 Wednesday — Roma
        (1,1,4,'checkin',    '2026-03-11 09:00:00+00','manual'),
        (1,1,4,'break_start','2026-03-11 13:00:00+00','manual'),
        (1,1,4,'break_end',  '2026-03-11 14:00:00+00','manual'),
        (1,1,4,'checkout',   '2026-03-11 18:02:00+00','manual'),
        (1,1,6,'checkin',    '2026-03-11 08:03:00+00','manual'),
        (1,1,6,'break_start','2026-03-11 12:01:00+00','manual'),
        (1,1,6,'break_end',  '2026-03-11 12:30:00+00','manual'),
        (1,1,6,'checkout',   '2026-03-11 14:01:00+00','manual'),
        (1,1,7,'checkin',    '2026-03-11 09:02:00+00','manual'),
        (1,1,7,'checkout',   '2026-03-11 13:59:00+00','manual'),
        -- Milano
        (1,2,5,'checkin',    '2026-03-11 09:01:00+00','manual'),
        (1,2,5,'break_start','2026-03-11 13:00:00+00','manual'),
        (1,2,5,'break_end',  '2026-03-11 14:00:00+00','manual'),
        (1,2,5,'checkout',   '2026-03-11 18:00:00+00','manual'),
        (1,2,8,'checkin',    '2026-03-11 09:03:00+00','manual'),
        (1,2,8,'break_start','2026-03-11 13:01:00+00','manual'),
        (1,2,8,'break_end',  '2026-03-11 14:01:00+00','manual'),
        (1,2,8,'checkout',   '2026-03-11 18:03:00+00','manual'),

        -- 2026-03-12 Thursday — Roma
        (1,1,4,'checkin',    '2026-03-12 09:05:00+00','manual'),
        (1,1,4,'break_start','2026-03-12 13:02:00+00','manual'),
        (1,1,4,'break_end',  '2026-03-12 14:00:00+00','manual'),
        (1,1,4,'checkout',   '2026-03-12 18:01:00+00','manual'),
        (1,1,6,'checkin',    '2026-03-12 14:01:00+00','manual'),
        (1,1,6,'break_start','2026-03-12 17:00:00+00','manual'),
        (1,1,6,'break_end',  '2026-03-12 17:31:00+00','manual'),
        (1,1,6,'checkout',   '2026-03-12 20:00:00+00','manual'),
        -- Milano
        (1,2,5,'checkin',    '2026-03-12 09:00:00+00','manual'),
        (1,2,5,'break_start','2026-03-12 13:00:00+00','manual'),
        (1,2,5,'break_end',  '2026-03-12 14:00:00+00','manual'),
        (1,2,5,'checkout',   '2026-03-12 18:02:00+00','manual'),
        (1,2,8,'checkin',    '2026-03-12 09:02:00+00','manual'),
        (1,2,8,'break_start','2026-03-12 13:00:00+00','manual'),
        (1,2,8,'break_end',  '2026-03-12 14:00:00+00','manual'),
        (1,2,8,'checkout',   '2026-03-12 18:01:00+00','manual'),

        -- 2026-03-13 Friday — Roma (no Roberto)
        (1,1,4,'checkin',    '2026-03-13 09:03:00+00','manual'),
        (1,1,4,'break_start','2026-03-13 13:00:00+00','manual'),
        (1,1,4,'break_end',  '2026-03-13 14:00:00+00','manual'),
        (1,1,4,'checkout',   '2026-03-13 18:04:00+00','manual'),
        (1,1,6,'checkin',    '2026-03-13 08:01:00+00','manual'),
        (1,1,6,'break_start','2026-03-13 12:00:00+00','manual'),
        (1,1,6,'break_end',  '2026-03-13 12:31:00+00','manual'),
        (1,1,6,'checkout',   '2026-03-13 14:03:00+00','manual'),
        -- Milano
        (1,2,5,'checkin',    '2026-03-13 09:01:00+00','manual'),
        (1,2,5,'break_start','2026-03-13 13:00:00+00','manual'),
        (1,2,5,'break_end',  '2026-03-13 14:01:00+00','manual'),
        (1,2,5,'checkout',   '2026-03-13 18:00:00+00','manual'),
        (1,2,8,'checkin',    '2026-03-13 09:04:00+00','manual'),
        (1,2,8,'break_start','2026-03-13 13:01:00+00','manual'),
        (1,2,8,'break_end',  '2026-03-13 13:59:00+00','manual'),
        (1,2,8,'checkout',   '2026-03-13 18:02:00+00','manual'),

        -- 2026-03-15 Saturday — Roma: Anna(6) rinforzo
        (1,1,6,'checkin',    '2026-03-15 10:01:00+00','manual'),
        (1,1,6,'break_start','2026-03-15 13:02:00+00','manual'),
        (1,1,6,'break_end',  '2026-03-15 14:01:00+00','manual'),
        (1,1,6,'checkout',   '2026-03-15 18:00:00+00','manual'),

        -- W12 confirmed: 2026-03-16 Monday — Roma + Milano
        (1,1,4,'checkin',    '2026-03-16 09:02:00+00','qr'),
        (1,1,4,'break_start','2026-03-16 13:00:00+00','qr'),
        (1,1,4,'break_end',  '2026-03-16 14:01:00+00','qr'),
        (1,1,4,'checkout',   '2026-03-16 18:03:00+00','qr'),
        (1,1,6,'checkin',    '2026-03-16 08:00:00+00','qr'),
        (1,1,6,'break_start','2026-03-16 12:01:00+00','qr'),
        (1,1,6,'break_end',  '2026-03-16 12:30:00+00','qr'),
        (1,1,6,'checkout',   '2026-03-16 14:02:00+00','qr'),
        (1,1,7,'checkin',    '2026-03-16 09:01:00+00','qr'),
        (1,1,7,'checkout',   '2026-03-16 14:00:00+00','qr'),
        (1,2,5,'checkin',    '2026-03-16 09:03:00+00','qr'),
        (1,2,5,'break_start','2026-03-16 13:00:00+00','qr'),
        (1,2,5,'break_end',  '2026-03-16 14:00:00+00','qr'),
        (1,2,5,'checkout',   '2026-03-16 18:01:00+00','qr'),
        (1,2,8,'checkin',    '2026-03-16 09:02:00+00','qr'),
        (1,2,8,'break_start','2026-03-16 13:01:00+00','qr'),
        (1,2,8,'break_end',  '2026-03-16 14:00:00+00','qr'),
        (1,2,8,'checkout',   '2026-03-16 18:00:00+00','qr'),

        -- W12 confirmed: 2026-03-17 Tuesday — Roma + Milano
        (1,1,4,'checkin',    '2026-03-17 09:04:00+00','qr'),
        (1,1,4,'break_start','2026-03-17 13:01:00+00','qr'),
        (1,1,4,'break_end',  '2026-03-17 14:00:00+00','qr'),
        (1,1,4,'checkout',   '2026-03-17 18:02:00+00','qr'),
        (1,1,6,'checkin',    '2026-03-17 14:01:00+00','qr'),
        (1,1,6,'break_start','2026-03-17 17:00:00+00','qr'),
        (1,1,6,'break_end',  '2026-03-17 17:30:00+00','qr'),
        (1,1,6,'checkout',   '2026-03-17 20:02:00+00','qr'),
        (1,1,7,'checkin',    '2026-03-17 09:00:00+00','qr'),
        (1,1,7,'checkout',   '2026-03-17 14:03:00+00','qr'),
        (1,2,5,'checkin',    '2026-03-17 09:01:00+00','qr'),
        (1,2,5,'break_start','2026-03-17 13:00:00+00','qr'),
        (1,2,5,'break_end',  '2026-03-17 14:02:00+00','qr'),
        (1,2,5,'checkout',   '2026-03-17 18:01:00+00','qr'),
        (1,2,8,'checkin',    '2026-03-17 09:03:00+00','qr'),
        (1,2,8,'break_start','2026-03-17 13:00:00+00','qr'),
        (1,2,8,'break_end',  '2026-03-17 14:01:00+00','qr'),
        (1,2,8,'checkout',   '2026-03-17 18:00:00+00','qr'),

        -- Beta Industries Napoli W12 confirmed: 2026-03-16
        (2,3,11,'checkin',    '2026-03-16 09:01:00+00','manual'),
        (2,3,11,'break_start','2026-03-16 13:00:00+00','manual'),
        (2,3,11,'break_end',  '2026-03-16 14:00:00+00','manual'),
        (2,3,11,'checkout',   '2026-03-16 18:02:00+00','manual'),
        (2,3,12,'checkin',    '2026-03-16 09:03:00+00','manual'),
        (2,3,12,'break_start','2026-03-16 13:01:00+00','manual'),
        (2,3,12,'break_end',  '2026-03-16 14:00:00+00','manual'),
        (2,3,12,'checkout',   '2026-03-16 18:01:00+00','manual'),
        (2,3,13,'checkin',    '2026-03-16 09:02:00+00','manual'),
        (2,3,13,'checkout',   '2026-03-16 14:00:00+00','manual'),
        -- 2026-03-17
        (2,3,11,'checkin',    '2026-03-17 09:00:00+00','manual'),
        (2,3,11,'break_start','2026-03-17 13:00:00+00','manual'),
        (2,3,11,'break_end',  '2026-03-17 14:01:00+00','manual'),
        (2,3,11,'checkout',   '2026-03-17 18:00:00+00','manual'),
        (2,3,12,'checkin',    '2026-03-17 14:02:00+00','manual'),
        (2,3,12,'break_start','2026-03-17 17:01:00+00','manual'),
        (2,3,12,'break_end',  '2026-03-17 17:30:00+00','manual'),
        (2,3,12,'checkout',   '2026-03-17 20:00:00+00','manual'),
        (2,3,13,'checkin',    '2026-03-17 09:01:00+00','manual'),
        (2,3,13,'checkout',   '2026-03-17 14:01:00+00','manual')
    `);
    console.log('✓ Attendance events seeded');

    // ── Today's demo data (always relative to CURRENT_DATE) ──────────────────
    // Ensures StoreManagerHome "Today's Shifts" + "Today's Attendance" widgets
    // always have visible data regardless of when Docker boots.

    // Today's shifts for Roma (store 1) — skipped if already seeded on this date
    const { rows: todayShiftCheck } = await client.query(
      `SELECT COUNT(*)::int AS count FROM shifts WHERE store_id = 1 AND date = CURRENT_DATE AND company_id = 1`
    );
    if (todayShiftCheck[0].count === 0) {
      await client.query(`
        INSERT INTO shifts (company_id, store_id, user_id, date, start_time, end_time, break_start, break_end, is_split, status, notes, created_by)
        VALUES
          (1, 1, 4, CURRENT_DATE, '09:00', '18:00', '13:00', '14:00', false, 'scheduled', NULL, 1),
          (1, 1, 6, CURRENT_DATE, '14:00', '20:00', '17:00', '17:30', false, 'scheduled', NULL, 1),
          (1, 1, 7, CURRENT_DATE, '09:00', '14:00', NULL,    NULL,    false, 'scheduled', NULL, 1)
      `);
      console.log('✓ Today\'s shifts seeded (dynamic date)');
    }

    await client.query(`
      UPDATE shifts
      SET
        timezone = COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'),
        start_at_utc = COALESCE(
          start_at_utc,
          ((date::timestamp + start_time) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
        ),
        end_at_utc = COALESCE(
          end_at_utc,
          ((date::timestamp + end_time) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
        ),
        break_start_at_utc = CASE
          WHEN break_start IS NULL THEN NULL
          ELSE COALESCE(
            break_start_at_utc,
            ((date::timestamp + break_start) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
          )
        END,
        break_end_at_utc = CASE
          WHEN break_end IS NULL THEN NULL
          ELSE COALESCE(
            break_end_at_utc,
            ((date::timestamp + break_end) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
          )
        END,
        split_start2_at_utc = CASE
          WHEN split_start2 IS NULL THEN NULL
          ELSE COALESCE(
            split_start2_at_utc,
            ((date::timestamp + split_start2) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
          )
        END,
        split_end2_at_utc = CASE
          WHEN split_end2 IS NULL THEN NULL
          ELSE COALESCE(
            split_end2_at_utc,
            ((date::timestamp + split_end2) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
          )
        END
      WHERE
        start_at_utc IS NULL
        OR end_at_utc IS NULL
        OR (break_start IS NOT NULL AND break_start_at_utc IS NULL)
        OR (break_end IS NOT NULL AND break_end_at_utc IS NULL)
        OR (split_start2 IS NOT NULL AND split_start2_at_utc IS NULL)
        OR (split_end2 IS NOT NULL AND split_end2_at_utc IS NULL)
        OR timezone IS NULL
        OR BTRIM(timezone) = ''
    `);
    console.log('✓ Shift UTC timestamps seeded');

    // Today's attendance events for Roma store — Sofia checked in + break, Roberto in+out
    await client.query(`
      INSERT INTO attendance_events (company_id, store_id, user_id, event_type, event_time, source)
      VALUES
        (1, 1, 4, 'checkin',     (CURRENT_DATE + INTERVAL '9 hours 3 minutes')::timestamptz,   'qr'),
        (1, 1, 4, 'break_start', (CURRENT_DATE + INTERVAL '13 hours 1 minute')::timestamptz,   'qr'),
        (1, 1, 7, 'checkin',     (CURRENT_DATE + INTERVAL '9 hours 11 minutes')::timestamptz,  'qr'),
        (1, 1, 7, 'checkout',    (CURRENT_DATE + INTERVAL '14 hours 2 minutes')::timestamptz,  'qr')
    `);
    console.log('✓ Today\'s attendance events seeded (dynamic date)');

    // Set Roberto's birthday to today (for birthday banner demo)
    await client.query(`
      UPDATE users
      SET date_of_birth = (NOW() - INTERVAL '28 years')::date
      WHERE id = 7
    `);
    console.log('✓ Birthday demo: Roberto\'s birthday set to today');

    // ── Shift templates ──────────────────────────────────────────────────────
    // Templates for FUSARO UOMO stores (store_id 1=Roma, 2=Milano)
    const tmplAdminId = 2; // HR user id
    await client.query(`
      INSERT INTO shift_templates (company_id, store_id, name, template_data, created_by) VALUES
      (1, 1, 'Settimana Standard Roma',
       '{"shifts":[
         {"dayOfWeek":0,"startTime":"09:00","endTime":"18:00","breakStart":"13:00","breakEnd":"14:00"},
         {"dayOfWeek":1,"startTime":"09:00","endTime":"18:00","breakStart":"13:00","breakEnd":"14:00"},
         {"dayOfWeek":2,"startTime":"09:00","endTime":"18:00","breakStart":"13:00","breakEnd":"14:00"},
         {"dayOfWeek":3,"startTime":"09:00","endTime":"18:00","breakStart":"13:00","breakEnd":"14:00"},
         {"dayOfWeek":4,"startTime":"09:00","endTime":"18:00","breakStart":"13:00","breakEnd":"14:00"}
       ]}'::jsonb, $1),
      (1, 1, 'Weekend Roma (Sab+Dom)',
       '{"shifts":[
         {"dayOfWeek":5,"startTime":"09:00","endTime":"20:00","breakStart":"14:00","breakEnd":"15:00"},
         {"dayOfWeek":6,"startTime":"10:00","endTime":"19:00","breakStart":"14:00","breakEnd":"15:00"}
       ]}'::jsonb, $1),
      (1, 2, 'Settimana Standard Milano',
       '{"shifts":[
         {"dayOfWeek":0,"startTime":"09:30","endTime":"18:30","breakStart":"13:00","breakEnd":"14:00"},
         {"dayOfWeek":1,"startTime":"09:30","endTime":"18:30","breakStart":"13:00","breakEnd":"14:00"},
         {"dayOfWeek":2,"startTime":"09:30","endTime":"18:30","breakStart":"13:00","breakEnd":"14:00"},
         {"dayOfWeek":3,"startTime":"09:30","endTime":"18:30","breakStart":"13:00","breakEnd":"14:00"},
         {"dayOfWeek":4,"startTime":"09:30","endTime":"18:30","breakStart":"13:00","breakEnd":"14:00"}
       ]}'::jsonb, $1),
      (1, 2, 'Turni Sera Milano',
       '{"shifts":[
         {"dayOfWeek":0,"startTime":"14:00","endTime":"21:00","breakStart":"17:30","breakEnd":"18:00"},
         {"dayOfWeek":1,"startTime":"14:00","endTime":"21:00","breakStart":"17:30","breakEnd":"18:00"},
         {"dayOfWeek":2,"startTime":"14:00","endTime":"21:00","breakStart":"17:30","breakEnd":"18:00"},
         {"dayOfWeek":3,"startTime":"14:00","endTime":"21:00","breakStart":"17:30","breakEnd":"18:00"},
         {"dayOfWeek":4,"startTime":"14:00","endTime":"21:00","breakStart":"17:30","breakEnd":"18:00"}
       ]}'::jsonb, $1)
    `, [tmplAdminId]);
    console.log('✓ Shift templates seeded (4 templates)');

    await ensureSuperAdmin(client);

    console.log('\n✅ Seed complete! Demo users password: password123\n');
    console.log('  Super admin credentials come from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD');
    console.log('  FUSARO UOMO');
    console.log('    admin@fusarouomo.com          Admin');
    console.log('    hr@fusarouomo.com             HR');
    console.log('    areamanager@fusarouomo.com    Area Manager');
    console.log('    manager.roma@fusarouomo.com   Store Manager (Roma)');
    console.log('    manager.milano@fusarouomo.com Store Manager (Milano)');
    console.log('    dipendente1@fusarouomo.com    Employee — Roma Cassa');
    console.log('    dipendente2@fusarouomo.com    Employee — Roma Magazzino');
    console.log('    dipendente3@fusarouomo.com    Employee — Milano Cassa');
    console.log('    terminal.roma@fusarouomo.com  Store Terminal — Roma');
    console.log('');
    console.log('  Beta Industries');
    console.log('    hr@beta.com                   HR');
    console.log('    manager@beta.com              Store Manager (Napoli)');
    console.log('    carol@beta.com                Employee — Napoli Vendite');
    console.log('    marco@beta.com                Employee — Napoli Cassa');

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { });
    throw err;
  } finally {
    client.release();
    // pool.end() is NOT called here — caller is responsible.
    // When run standalone (npm run seed), the entry point below closes the pool.
  }
}

// Only auto-run + close pool when executed directly (npm run seed / seed:prod).
if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
