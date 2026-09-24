import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import storesRoutes from '../../stores/stores.routes';
import employeesRoutes from '../../employees/employees.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

/**
 * Every way a company could end up using more licences than it pays for.
 *
 * Creating an employee was already gated; these cover the three ways round it:
 * a terminal created together with a store, an employee (or terminal) switched
 * back on, and a whole store switched back on with its terminal.
 */

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/stores', storesRoutes);
app.use('/api/employees', employeesRoutes);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Mirrors the real error middleware for the 402 the licence gate throws.
  const status = err?.statusCode ?? 500;
  res.status(status).json({ success: false, error: err.message, code: err?.code ?? 'SERVER_ERROR' });
});

const request = supertest(app);

let seeds: Awaited<ReturnType<typeof seedTestData>>;

async function login(email: string, password = 'password123'): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password });
  return res.body.data.token as string;
}

async function countBillable(companyId: number) {
  const { rows } = await testPool.query(
    `SELECT
       COUNT(*) FILTER (WHERE role <> 'store_terminal' AND status = 'active')::int AS employees,
       COUNT(*) FILTER (WHERE role =  'store_terminal' AND status = 'active')::int AS terminals
     FROM users WHERE company_id = $1`,
    [companyId],
  );
  return rows[0] as { employees: number; terminals: number };
}

/** Puts the company on the billing model with exactly the licences given. */
async function setLicences(companyId: number, seats: number, devices: number) {
  await testPool.query(`UPDATE companies SET billing_enforced = true WHERE id = $1`, [companyId]);
  await testPool.query(`DELETE FROM subscriptions WHERE company_id = $1`, [companyId]);
  await testPool.query(
    `INSERT INTO subscriptions (company_id, provider, status, seat_quantity, device_quantity,
                                unit_price_employee, unit_price_device, currency)
     VALUES ($1, 'stripe', 'active', $2, $3, 5, 9, 'EUR')`,
    [companyId, seats, devices],
  );
}

async function clearLicences(companyId: number) {
  await testPool.query(`DELETE FROM subscriptions WHERE company_id = $1`, [companyId]);
  await testPool.query(`UPDATE companies SET billing_enforced = false WHERE id = $1`, [companyId]);
}

beforeAll(async () => {
  seeds = await seedTestData();
  await testPool.query('DELETE FROM login_attempts');
});

afterEach(async () => {
  await clearLicences(seeds.acmeId);
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

describe('reactivating an employee', () => {
  it('is refused when every employee licence is in use', async () => {
    const token = await login('admin@acme-test.com');

    await testPool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [seeds.employee1Id]);
    const counts = await countBillable(seeds.acmeId);
    // Licences exactly cover who is active now, so the returning employee has none.
    await setLicences(seeds.acmeId, counts.employees, counts.terminals + 5);

    const res = await request
      .patch(`/api/employees/${seeds.employee1Id}/activate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('LICENSE_LIMIT_REACHED');

    const { rows } = await testPool.query(`SELECT status FROM users WHERE id = $1`, [seeds.employee1Id]);
    expect(rows[0].status).toBe('inactive');
  });

  it('goes through when a licence is free', async () => {
    const token = await login('admin@acme-test.com');

    await testPool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [seeds.employee1Id]);
    const counts = await countBillable(seeds.acmeId);
    await setLicences(seeds.acmeId, counts.employees + 1, counts.terminals + 5);

    const res = await request
      .patch(`/api/employees/${seeds.employee1Id}/activate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const { rows } = await testPool.query(`SELECT status FROM users WHERE id = $1`, [seeds.employee1Id]);
    expect(rows[0].status).toBe('active');
  });
});

describe('creating a store with a terminal account', () => {
  afterEach(async () => {
    await testPool.query(`DELETE FROM users WHERE email = 'gate-terminal@acme-test.com'`);
    await testPool.query(`DELETE FROM stores WHERE code IN ('GATE-1', 'GATE-2')`);
  });

  it('is refused when every terminal licence is in use, and creates no store', async () => {
    const token = await login('admin@acme-test.com');
    const counts = await countBillable(seeds.acmeId);
    await setLicences(seeds.acmeId, counts.employees + 5, counts.terminals);

    const res = await request
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Gate Store',
        code: 'GATE-1',
        max_staff: 4,
        terminal: { email: 'gate-terminal@acme-test.com', password: 'password123' },
      });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('LICENSE_LIMIT_REACHED');

    const { rows } = await testPool.query(`SELECT id FROM stores WHERE code = 'GATE-1'`);
    expect(rows).toHaveLength(0);
  });

  it('goes through when a terminal licence is free', async () => {
    const token = await login('admin@acme-test.com');
    const counts = await countBillable(seeds.acmeId);
    await setLicences(seeds.acmeId, counts.employees + 5, counts.terminals + 1);

    const res = await request
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Gate Store 2',
        code: 'GATE-2',
        max_staff: 4,
        terminal: { email: 'gate-terminal@acme-test.com', password: 'password123' },
      });

    expect(res.status).toBe(201);
    const { rows } = await testPool.query(
      `SELECT status FROM users WHERE email = 'gate-terminal@acme-test.com'`,
    );
    expect(rows[0].status).toBe('active');
  });

  it('still creates a store with no terminal when licences are full', async () => {
    const token = await login('admin@acme-test.com');
    const counts = await countBillable(seeds.acmeId);
    await setLicences(seeds.acmeId, counts.employees + 5, counts.terminals);

    const res = await request
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Gate Store', code: 'GATE-1', max_staff: 4 });

    expect(res.status).toBe(201);
  });
});

describe('reactivating a store', () => {
  let storeId: number;
  let terminalId: number;

  beforeEach(async () => {
    const { rows: [store] } = await testPool.query(
      `INSERT INTO stores (company_id, name, code, max_staff, is_active)
       VALUES ($1, 'Dormant', 'GATE-D1', 4, false) RETURNING id`,
      [seeds.acmeId],
    );
    storeId = store.id;
    const { rows: [terminal] } = await testPool.query(
      `INSERT INTO users (company_id, store_id, name, surname, email, password_hash, role, status)
       VALUES ($1, $2, 'Dormant', 'Terminale', 'gate-dormant@acme-test.com', 'x', 'store_terminal', 'inactive')
       RETURNING id`,
      [seeds.acmeId, storeId],
    );
    terminalId = terminal.id;
  });

  afterEach(async () => {
    await testPool.query(`DELETE FROM users WHERE id = $1`, [terminalId]);
    await testPool.query(`DELETE FROM stores WHERE id = $1`, [storeId]);
  });

  it('is refused when the terminal has no licence, leaving the store closed', async () => {
    const token = await login('admin@acme-test.com');
    const counts = await countBillable(seeds.acmeId);
    await setLicences(seeds.acmeId, counts.employees + 5, counts.terminals);

    const res = await request
      .patch(`/api/stores/${storeId}/activate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('LICENSE_LIMIT_REACHED');

    const { rows } = await testPool.query(
      `SELECT s.is_active, u.status FROM stores s JOIN users u ON u.store_id = s.id WHERE s.id = $1`,
      [storeId],
    );
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].status).toBe('inactive');
  });

  it('switches store and terminal back on together when a licence is free', async () => {
    const token = await login('admin@acme-test.com');
    const counts = await countBillable(seeds.acmeId);
    await setLicences(seeds.acmeId, counts.employees + 5, counts.terminals + 1);

    const res = await request
      .patch(`/api/stores/${storeId}/activate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const { rows } = await testPool.query(
      `SELECT s.is_active, u.status FROM stores s JOIN users u ON u.store_id = s.id WHERE s.id = $1`,
      [storeId],
    );
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].status).toBe('active');
  });
});

describe('a company not on the billing model', () => {
  it('is not gated at all', async () => {
    const token = await login('admin@acme-test.com');
    await testPool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [seeds.employee1Id]);
    // billing_enforced stays false and there is no subscription.

    const res = await request
      .patch(`/api/employees/${seeds.employee1Id}/activate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
