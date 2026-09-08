import bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { pool } from '../config/database';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug.length > 0 ? slug : 'default-company';
}

async function resolveDefaultCompanyId(runner: PoolClient | typeof pool): Promise<number | null> {
  const { rows } = await runner.query<{ id: number }>(
    `SELECT id FROM companies ORDER BY id LIMIT 1`
  );
  if (rows[0]?.id) {
    return rows[0].id;
  }

  const name = optionalEnv('DEFAULT_COMPANY_NAME') ?? 'FUSARO UOMO'; 
  const slug = optionalEnv('DEFAULT_COMPANY_SLUG') ?? slugify(name); 

  const { rows: created } = await runner.query<{ id: number }>(
    `INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`,
    [name, slug]
  );
  console.log('✓ Default company created');
  return created[0]?.id ?? null;
}

export async function ensureSuperAdmin(client?: PoolClient): Promise<void> {
  const email = requireEnv('SUPER_ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SUPER_ADMIN_PASSWORD');
  if (password.length < 8) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters.');
  }

  const superAdminName = 'Marco';
  const superAdminSurname = 'Rossi';

  const runner = client ?? pool;
  const passwordHash = await bcrypt.hash(password, 12);

  const defaultCompanyId = await resolveDefaultCompanyId(runner);

  // Demote any other super admins without deleting users (keeps FK integrity)
  await runner.query(
    `UPDATE users
     SET is_super_admin = false,
         status = 'inactive',
         updated_at = NOW()
     WHERE is_super_admin = true AND LOWER(email) <> LOWER($1)`,
    [email]
  );

  const { rows } = await runner.query<{ id: number }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );

  if (rows.length > 0) {
    await runner.query(
      `UPDATE users
       SET name = $1,
           surname = $2,
           password_hash = $3,
            role = 'admin',
            status = 'active',
            is_super_admin = true,
            company_id = $4,
            updated_at = NOW()
       WHERE id = $5`,
      [superAdminName, superAdminSurname, passwordHash, defaultCompanyId, rows[0].id]
    );
    console.log('✓ Super admin updated');
  } else {
    await runner.query(
      `INSERT INTO users (
         company_id, name, surname, email, password_hash,
         role, status, is_super_admin
        ) VALUES ($1, $2, $3, $4, $5, 'admin', 'active', true)`,
      [defaultCompanyId, superAdminName, superAdminSurname, email, passwordHash]
    );
    console.log('✓ Super admin created');
  }

  console.log('✓ Super admin ensured');
}
