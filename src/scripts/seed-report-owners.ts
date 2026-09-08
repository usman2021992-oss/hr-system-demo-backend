/**
 * Seeds the per-owner report configurations introduced by migration 115.
 *
 * Every company gets:
 *   - one Admin row  -> company-wide monthly + weekly
 *   - one HR row per store -> store-scoped monthly + weekly + daily
 *
 * Idempotent: reruns update existing rows rather than duplicating them. Existing
 * schedules keep their status, so re-seeding never silently re-enables a report
 * somebody deliberately paused.
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../config/database';
import { REPORT_DEFINITIONS, reportsForRole } from '../modules/reports/reports-registry';

interface StoreRow { id: number; name: string }
interface UserRow { id: number; name: string; surname: string; store_id: number | null }

async function ensureHrForStore(companyId: number, store: StoreRow, index: number): Promise<UserRow> {
  const existing = await queryOne<UserRow>(
    `SELECT id, name, surname, store_id FROM users
      WHERE company_id = $1 AND role = 'hr' AND store_id = $2 AND status = 'active'
      LIMIT 1`,
    [companyId, store.id],
  );
  if (existing) return existing;

  // Reuse an unassigned HR before creating a new one, so we don't leave orphans.
  const unassigned = await queryOne<UserRow>(
    `SELECT id, name, surname, store_id FROM users
      WHERE company_id = $1 AND role = 'hr' AND store_id IS NULL AND status = 'active'
      LIMIT 1`,
    [companyId],
  );
  if (unassigned) {
    await query(`UPDATE users SET store_id = $1 WHERE id = $2`, [store.id, unassigned.id]);
    console.log(`  assigned existing HR ${unassigned.name} ${unassigned.surname} -> ${store.name}`);
    return { ...unassigned, store_id: store.id };
  }

  const names = [
    { name: 'Giulia', surname: 'Ferrari' },
    { name: 'Marco', surname: 'Conti' },
    { name: 'Elena', surname: 'Greco' },
    { name: 'Davide', surname: 'Moretti' },
  ];
  const pick = names[index % names.length];
  const email = `hr.${store.id}.${pick.surname.toLowerCase()}@company${companyId}.local`;
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const created = await queryOne<UserRow>(
    `INSERT INTO users (company_id, store_id, name, surname, email, password_hash, role, status, hire_date)
     VALUES ($1, $2, $3, $4, $5, $6, 'hr', 'active', CURRENT_DATE - 400)
     ON CONFLICT (email) DO UPDATE SET store_id = EXCLUDED.store_id
     RETURNING id, name, surname, store_id`,
    [companyId, store.id, pick.name, pick.surname, email, passwordHash],
  );
  console.log(`  created HR ${pick.name} ${pick.surname} -> ${store.name} (${email})`);
  return created!;
}

async function upsertConfig(
  companyId: number,
  reportId: string,
  ownerUserId: number,
  storeId: number | null,
  recipients: string[],
) {
  const definition = REPORT_DEFINITIONS.find(d => d.id === reportId)!;
  await query(
    `INSERT INTO report_configurations
       (company_id, report_id, owner_user_id, store_id, day, time, recipients, sections, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
     ON CONFLICT (company_id, report_id, COALESCE(owner_user_id, 0))
     DO UPDATE SET
       store_id = EXCLUDED.store_id,
       sections = EXCLUDED.sections,
       recipients = EXCLUDED.recipients
     -- status intentionally NOT overwritten: never re-enable a paused report.
    `,
    [
      companyId, reportId, ownerUserId, storeId,
      definition.defaultDay, definition.defaultTime,
      JSON.stringify(recipients), JSON.stringify(definition.defaultSections),
      definition.defaultStatus,
    ],
  );
}

async function main() {
  const companies = await query<{ id: number; name: string }>('SELECT id, name FROM companies ORDER BY id');

  for (const company of companies) {
    console.log(`\n[${company.name}]`);

    const admin = await queryOne<UserRow & { email: string }>(
      `SELECT id, name, surname, store_id, email FROM users
        WHERE company_id = $1 AND role = 'admin' AND status = 'active'
        ORDER BY id LIMIT 1`,
      [company.id],
    );

    if (!admin) {
      console.log('  no active admin; skipping');
      continue;
    }

    for (const definition of reportsForRole('admin')) {
      await upsertConfig(company.id, definition.id, admin.id, null, [admin.email]);
    }
    console.log(`  admin ${admin.name} ${admin.surname}: ${reportsForRole('admin').length} report(s)`);

    const stores = await query<StoreRow>(
      `SELECT id, name FROM stores WHERE company_id = $1 AND is_active ORDER BY id`,
      [company.id],
    );

    if (stores.length === 0) {
      console.log('  no active stores; skipping HR rows');
      continue;
    }

    for (const [i, store] of stores.entries()) {
      const hr = await ensureHrForStore(company.id, store, i);
      const contact = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [hr.id]);
      for (const definition of reportsForRole('hr')) {
        await upsertConfig(company.id, definition.id, hr.id, store.id, contact ? [contact.email] : []);
      }
      console.log(`  hr ${hr.name} ${hr.surname} @ ${store.name}: ${reportsForRole('hr').length} report(s)`);
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
