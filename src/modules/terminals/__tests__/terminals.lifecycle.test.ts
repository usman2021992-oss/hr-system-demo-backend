import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import terminalsRoutes from '../terminals.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

/**
 * Who may touch a terminal, and what "delete" now means.
 *
 * Terminals were open to every authenticated user in the company — an employee
 * could read the list, which carried the plain passwords, and delete accounts
 * outright. Deleting also erased the row and its audit trail.
 */

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/terminals', terminalsRoutes);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.statusCode ?? 500;
  res.status(status).json({ success: false, error: err.message, code: err?.code ?? 'SERVER_ERROR' });
});

const request = supertest(app);

let seeds: Awaited<ReturnType<typeof seedTestData>>;
let storeId: number;

async function login(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token as string;
}

/** A fresh terminal on its own store, so each test starts from a known place. */
async function makeTerminal(email = 'lifecycle-terminal@acme-test.com') {
  const { rows: [store] } = await testPool.query(
    `INSERT INTO stores (company_id, name, code, max_staff) VALUES ($1, 'Lifecycle', $2, 5) RETURNING id`,
    [seeds.acmeId, `LC-${Date.now() % 100000}`],
  );
  const { rows: [terminal] } = await testPool.query(
    `INSERT INTO users (company_id, store_id, name, surname, email, password_hash, plain_password, role, status)
     VALUES ($1, $2, 'Lifecycle', 'Terminale', $3, 'x', 'terminalpass', 'store_terminal', 'active')
     RETURNING id`,
    [seeds.acmeId, store.id, email],
  );
  return { storeId: store.id as number, terminalId: terminal.id as number };
}

beforeAll(async () => {
  seeds = await seedTestData();
  await testPool.query('DELETE FROM login_attempts');
});

afterEach(async () => {
  await testPool.query(`DELETE FROM users WHERE email LIKE '%lifecycle-terminal%' OR email LIKE 'deleted:%'`);
  await testPool.query(`DELETE FROM stores WHERE name = 'Lifecycle'`);
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

describe('who may reach the terminal routes', () => {
  it('refuses an employee outright', async () => {
    const token = await login('employee1@acme-test.com');
    expect((await request.get('/api/terminals').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request.post('/api/terminals').set('Authorization', `Bearer ${token}`).send({})).status).toBe(403);
  });

  it('lets a store manager look but not change', async () => {
    const token = await login('manager.roma@acme-test.com');
    const { terminalId } = await makeTerminal();

    expect((await request.get('/api/terminals').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request.patch(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${token}`).send({ email: 'x@y.z' })).status).toBe(403);
    expect((await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request.get(`/api/terminals/${terminalId}/password`).set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  it('lets hr manage but not delete', async () => {
    const token = await login('hr@acme-test.com');
    const { terminalId } = await makeTerminal();

    expect((await request.get(`/api/terminals/${terminalId}/password`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  it('keeps the deleted view and its actions for the super admin alone', async () => {
    const adminToken = await login('admin@acme-test.com');
    const { terminalId } = await makeTerminal();
    await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${adminToken}`);

    // An admin asking for the deleted view gets the live list instead.
    const asAdmin = await request.get('/api/terminals?deleted=true').set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.body.data.data.some((t: any) => t.id === terminalId)).toBe(false);

    expect((await request.post(`/api/terminals/${terminalId}/restore`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(403);
    expect((await request.delete(`/api/terminals/${terminalId}/permanent`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(403);

    const superToken = await login('superadmin@acme-test.com');
    const asSuper = await request.get('/api/terminals?deleted=true').set('Authorization', `Bearer ${superToken}`);
    expect(asSuper.body.data.data.some((t: any) => t.id === terminalId)).toBe(true);
  });
});

describe('the password', () => {
  it('never travels in the list', async () => {
    const token = await login('admin@acme-test.com');
    await makeTerminal();
    const res = await request.get('/api/terminals').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data.data) {
      expect(row).not.toHaveProperty('plainPassword');
      expect(row).not.toHaveProperty('plain_password');
    }
  });

  it('is read one at a time, and the read is recorded', async () => {
    const token = await login('admin@acme-test.com');
    const { terminalId } = await makeTerminal();

    const res = await request.get(`/api/terminals/${terminalId}/password`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.password).toBe('terminalpass');

    const { rows } = await testPool.query(
      `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'TERMINAL_PASSWORD_VIEW'`,
      [terminalId],
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('deleting a terminal', () => {
  it('archives it instead of destroying it, and leaves a trail', async () => {
    const token = await login('admin@acme-test.com');
    const { terminalId } = await makeTerminal();

    const res = await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const { rows } = await testPool.query(
      `SELECT status, deleted_at, deleted_by, email FROM users WHERE id = $1`,
      [terminalId],
    );
    expect(rows).toHaveLength(1);                 // the row is still there
    expect(rows[0].status).toBe('inactive');      // not billable, cannot log in
    expect(rows[0].deleted_at).not.toBeNull();
    expect(rows[0].deleted_by).not.toBeNull();
    expect(rows[0].email).toMatch(/^deleted:\d+:/); // address freed for reuse

    const audit = await testPool.query(
      `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'TERMINAL_ARCHIVE'`,
      [terminalId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('takes it out of the list and frees its store for a new one', async () => {
    const token = await login('admin@acme-test.com');
    const { storeId: store, terminalId } = await makeTerminal();
    await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${token}`);

    const list = await request.get('/api/terminals').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.data.some((t: any) => t.id === terminalId)).toBe(false);

    const stores = await request.get('/api/terminals/stores-status').set('Authorization', `Bearer ${token}`);
    const row = stores.body.data.find((s: any) => s.id === store);
    expect(row.hasTerminal).toBe(false);

    // And the freed address can be used again straight away.
    const created = await request
      .post('/api/terminals')
      .set('Authorization', `Bearer ${token}`)
      .send({ store_id: store, email: 'lifecycle-terminal@acme-test.com', password: 'password123' });
    expect(created.status).toBe(201);
  });

  it('stops counting towards the licences', async () => {
    const token = await login('admin@acme-test.com');
    const { terminalId } = await makeTerminal();

    const before = await testPool.query(
      `SELECT COUNT(*)::int AS c FROM users WHERE company_id = $1 AND status = 'active' AND role = 'store_terminal'`,
      [seeds.acmeId],
    );
    await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${token}`);
    const after = await testPool.query(
      `SELECT COUNT(*)::int AS c FROM users WHERE company_id = $1 AND status = 'active' AND role = 'store_terminal'`,
      [seeds.acmeId],
    );

    expect(after.rows[0].c).toBe(before.rows[0].c - 1);
  });
});

describe('the deleted view', () => {
  it('restores a terminal, inactive and with its address back', async () => {
    const adminToken = await login('admin@acme-test.com');
    const superToken = await login('superadmin@acme-test.com');
    const { terminalId } = await makeTerminal();
    await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${adminToken}`);

    const res = await request.post(`/api/terminals/${terminalId}/restore`).set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);

    const { rows } = await testPool.query(`SELECT status, deleted_at, email FROM users WHERE id = $1`, [terminalId]);
    expect(rows[0].deleted_at).toBeNull();
    expect(rows[0].status).toBe('inactive');  // activating is a separate, licence-checked step
    expect(rows[0].email).toBe('lifecycle-terminal@acme-test.com');
  });

  it('refuses to restore onto a store that has been given a new terminal', async () => {
    const adminToken = await login('admin@acme-test.com');
    const superToken = await login('superadmin@acme-test.com');
    const { storeId: store, terminalId } = await makeTerminal();
    await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${adminToken}`);
    await request
      .post('/api/terminals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ store_id: store, email: 'lifecycle-terminal2@acme-test.com', password: 'password123' });

    const res = await request.post(`/api/terminals/${terminalId}/restore`).set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STORE_HAS_TERMINAL');

    await testPool.query(`DELETE FROM users WHERE email = 'lifecycle-terminal2@acme-test.com'`);
  });

  it('deletes for good, and the audit trail outlives the account', async () => {
    const adminToken = await login('admin@acme-test.com');
    const superToken = await login('superadmin@acme-test.com');
    const { terminalId } = await makeTerminal();
    await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${adminToken}`);

    const res = await request.delete(`/api/terminals/${terminalId}/permanent`).set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);

    const gone = await testPool.query(`SELECT 1 FROM users WHERE id = $1`, [terminalId]);
    expect(gone.rows).toHaveLength(0);

    // The record of what happened survives, with its user_id nulled.
    const audit = await testPool.query(
      `SELECT user_id FROM audit_logs WHERE entity_id = $1 AND action = 'TERMINAL_ARCHIVE'`,
      [terminalId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('refuses a permanent delete while attendance rows point at it', async () => {
    const adminToken = await login('admin@acme-test.com');
    const superToken = await login('superadmin@acme-test.com');
    const { storeId: store, terminalId } = await makeTerminal();
    await request.delete(`/api/terminals/${terminalId}`).set('Authorization', `Bearer ${adminToken}`);

    await testPool.query(
      `INSERT INTO attendance_events (company_id, store_id, user_id, event_type, event_time)
       VALUES ($1, $2, $3, 'checkin', NOW())`,
      [seeds.acmeId, store, terminalId],
    );

    const res = await request.delete(`/api/terminals/${terminalId}/permanent`).set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TERMINAL_HAS_ATTENDANCE');

    const still = await testPool.query(`SELECT 1 FROM users WHERE id = $1`, [terminalId]);
    expect(still.rows).toHaveLength(1);

    await testPool.query(`DELETE FROM attendance_events WHERE user_id = $1`, [terminalId]);
  });
});

describe('deactivate and activate', () => {
  it('switches a terminal off and back on, and the trail records both', async () => {
    const token = await login('hr@acme-test.com');
    const { terminalId } = await makeTerminal();

    expect((await request.patch(`/api/terminals/${terminalId}/deactivate`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    let row = await testPool.query(`SELECT status FROM users WHERE id = $1`, [terminalId]);
    expect(row.rows[0].status).toBe('inactive');

    expect((await request.patch(`/api/terminals/${terminalId}/activate`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    row = await testPool.query(`SELECT status FROM users WHERE id = $1`, [terminalId]);
    expect(row.rows[0].status).toBe('active');

    const audit = await testPool.query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 AND action IN ('TERMINAL_DEACTIVATE','TERMINAL_ACTIVATE')`,
      [terminalId],
    );
    expect(audit.rows.length).toBe(2);
  });

  it('will not activate past the paid licences', async () => {
    const token = await login('hr@acme-test.com');
    const { terminalId } = await makeTerminal();
    await request.patch(`/api/terminals/${terminalId}/deactivate`).set('Authorization', `Bearer ${token}`);

    const { rows: [counts] } = await testPool.query(
      `SELECT COUNT(*)::int AS terminals FROM users
        WHERE company_id = $1 AND status = 'active' AND role = 'store_terminal'`,
      [seeds.acmeId],
    );
    await testPool.query(`UPDATE companies SET billing_enforced = true WHERE id = $1`, [seeds.acmeId]);
    await testPool.query(
      `INSERT INTO subscriptions (company_id, provider, status, seat_quantity, device_quantity,
                                  unit_price_employee, unit_price_device, currency)
       VALUES ($1, 'stripe', 'active', 500, $2, 5, 9, 'EUR')`,
      [seeds.acmeId, counts.terminals],
    );

    try {
      const res = await request.patch(`/api/terminals/${terminalId}/activate`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(402);
      expect(res.body.code).toBe('LICENSE_LIMIT_REACHED');
    } finally {
      await testPool.query(`DELETE FROM subscriptions WHERE company_id = $1`, [seeds.acmeId]);
      await testPool.query(`UPDATE companies SET billing_enforced = false WHERE id = $1`, [seeds.acmeId]);
    }
  });
});
