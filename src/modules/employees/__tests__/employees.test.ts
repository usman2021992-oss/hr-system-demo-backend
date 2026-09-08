import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import employeesRoutes from '../employees.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);

let seeds: Awaited<ReturnType<typeof seedTestData>>;

async function login(email: string, password = 'password123'): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password });
  return res.body.data.token as string;
}

beforeAll(async () => {
  seeds = await seedTestData();
  // Clean up login attempts from seed
  await testPool.query('DELETE FROM login_attempts');
  await testPool.query('DELETE FROM audit_logs');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// GET /api/employees
// ---------------------------------------------------------------------------

describe('GET /api/employees', () => {
  it('admin sees all employees', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request.get('/api/employees').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Seed creates: admin, hr, area_manager, store_manager, employee1 = 5 total
    expect(res.body.data.total).toBeGreaterThanOrEqual(5);
  });

  it('hr sees all employees', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request.get('/api/employees').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(5);
  });

  it('area_manager can see employees across their allowed group companies', async () => {
    const token = await login('area@acme-test.com');
    const res = await request.get('/api/employees').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // group visibility enables cross-company listing for area_manager
    const emails = res.body.data.employees.map((e: any) => e.email);
    expect(emails).toContain('admin@acme-test.com');
  });

  it('store_manager sees only employees in their store', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request.get('/api/employees').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const emails = res.body.data.employees.map((e: any) => e.email);
    expect(emails).toContain('employee1@acme-test.com');
    // Should not see admin/hr who are not in the store
    expect(emails).not.toContain('admin@acme-test.com');
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request.get('/api/employees');
    expect(res.status).toBe(401);
  });

  it('filter by status works', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/employees')
      .query({ status: 'active' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const employees: any[] = res.body.data.employees;
    employees.forEach((e) => expect(e.status).toBe('active'));
  });

  it('pagination works', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/employees')
      .query({ page: '1', limit: '2' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.employees.length).toBeLessThanOrEqual(2);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(2);
    expect(res.body.data.pages).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/employees/:id
// ---------------------------------------------------------------------------

describe('GET /api/employees/:id', () => {
  it('admin gets full detail including personal_email field', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('employee1@acme-test.com');
    // DETAIL_FIELDS includes personal_email for admin
    expect(Object.prototype.hasOwnProperty.call(res.body.data, 'personal_email')).toBe(true);
  });

  it('area_manager can open admin detail from the employees list scope', async () => {
    const token = await login('area@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.adminId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('admin@acme-test.com');
    expect(Object.prototype.hasOwnProperty.call(res.body.data, 'personal_email')).toBe(true);
  });

  it('employee gets their own detail including personal_email', async () => {
    const token = await login('employee1@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('employee1@acme-test.com');
    expect(Object.prototype.hasOwnProperty.call(res.body.data, 'personal_email')).toBe(true);
  });

  it('employee gets 403 trying to view another employee', async () => {
    const token = await login('employee1@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.adminId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('store_manager gets 403 for employee outside their store', async () => {
    const token = await login('manager.roma@acme-test.com');
    // adminId is not in the roma store
    const res = await request
      .get(`/api/employees/${seeds.adminId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for nonexistent employee', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/employees/999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/employees/:id/associations', () => {
  it('area_manager can load admin associations from the employees list scope', async () => {
    const token = await login('area@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.adminId}/associations`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subject.id).toBe(seeds.adminId);
    expect(Array.isArray(res.body.data.companies)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/employees
// ---------------------------------------------------------------------------

describe('POST /api/employees', () => {
  it('admin creates a new employee', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Giulia',
        surname: 'Rossi',
        email: 'giulia.rossi@acme-test.com',
        role: 'employee',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('giulia.rossi@acme-test.com');
    expect(res.body.data.name).toBe('Giulia');
    // Cleanup
    await testPool.query(`DELETE FROM users WHERE email = 'giulia.rossi@acme-test.com'`);
  });

  it('hr creates a new employee', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Marco',
        surname: 'Bianchi',
        email: 'marco.bianchi@acme-test.com',
        role: 'employee',
      });
    expect(res.status).toBe(201);
    // Cleanup
    await testPool.query(`DELETE FROM users WHERE email = 'marco.bianchi@acme-test.com'`);
  });

  it('hr can create an employee in another allowed company using company_id + store_id', async () => {
    const token = await login('hr@acme-test.com');

    const { rows: [betaStore] } = await testPool.query<{ id: number }>(
      `INSERT INTO stores (company_id, name, code, max_staff)
       VALUES ($1, 'Beta Test Store', 'BETA-T1', 8)
       ON CONFLICT (company_id, code)
       DO UPDATE SET name = EXCLUDED.name, max_staff = EXCLUDED.max_staff
       RETURNING id`,
      [seeds.betaId],
    );

    const res = await request
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Cross',
        surname: 'Company',
        email: 'cross.company@acme-test.com',
        role: 'employee',
        company_id: seeds.betaId,
        store_id: betaStore.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.company_id).toBe(seeds.betaId);
    expect(res.body.data.store_id).toBe(betaStore.id);

    await testPool.query(`DELETE FROM users WHERE email = 'cross.company@acme-test.com'`);
  });

  it('area_manager can create a new employee', async () => {
    const token = await login('area@acme-test.com');
    const res = await request
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test',
        surname: 'User',
        email: 'test.area@acme-test.com',
        role: 'employee',
      });
    expect(res.status).toBe(201);
    await testPool.query(`DELETE FROM users WHERE email = 'test.area@acme-test.com'`);
  });

  it('returns 409 with CODE EMAIL_CONFLICT for duplicate email', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Admin',
        surname: 'Duplicate',
        email: 'admin@acme-test.com', // already exists
        role: 'employee',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_CONFLICT');
  });

  it('returns 400 for missing name', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({
        surname: 'Rossi',
        email: 'nessun.nome@acme-test.com',
        role: 'employee',
      });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/employees/:id
// ---------------------------------------------------------------------------

describe('PUT /api/employees/:id', () => {
  it('admin updates employee name', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put(`/api/employees/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Anna Updated',
        surname: 'Test',
        role: 'employee',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Anna Updated');
    // Restore original name
    await testPool.query(`UPDATE users SET name = 'Anna' WHERE id = $1`, [seeds.employee1Id]);
  });

  it('admin updates employee email', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put(`/api/employees/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Anna',
        surname: 'Test',
        role: 'employee',
        email: 'employee1.updated@acme-test.com',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('employee1.updated@acme-test.com');

    // Restore original email for subsequent tests.
    await testPool.query(`UPDATE users SET email = 'employee1@acme-test.com' WHERE id = $1`, [seeds.employee1Id]);
  });

  it('hr updates employee', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request
      .put(`/api/employees/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Anna',
        surname: 'HR Updated',
        role: 'employee',
      });
    expect(res.status).toBe(200);
    // Restore
    await testPool.query(`UPDATE users SET surname = 'Test' WHERE id = $1`, [seeds.employee1Id]);
  });

  it('area_manager gets 403 trying to update employee', async () => {
    const token = await login('area@acme-test.com');
    const res = await request
      .put(`/api/employees/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Anna',
        surname: 'Test',
        role: 'employee',
      });
    expect(res.status).toBe(403);
  });

  it('returns 404 for nonexistent employee', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put('/api/employees/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Ghost',
        surname: 'User',
        role: 'employee',
      });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/employees/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/employees/:id', () => {
  it('admin deactivates employee and response has status=inactive', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .delete(`/api/employees/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('inactive');
    // Restore for subsequent tests
    await testPool.query(`UPDATE users SET status = 'active', termination_date = NULL WHERE id = $1`, [seeds.employee1Id]);
  });

  it('hr gets 403 trying to deactivate employee', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request
      .delete(`/api/employees/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/employees/:id/activate
// ---------------------------------------------------------------------------

describe('PATCH /api/employees/:id/activate', () => {
  it('admin reactivates a deactivated employee', async () => {
    // First deactivate
    await testPool.query(
      `UPDATE users SET status = 'inactive', termination_date = CURRENT_DATE WHERE id = $1`,
      [seeds.employee1Id],
    );

    const token = await login('admin@acme-test.com');
    const res = await request
      .patch(`/api/employees/${seeds.employee1Id}/activate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.termination_date).toBeNull();
  });
});
