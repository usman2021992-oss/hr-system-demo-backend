import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import storesRoutes from '../stores.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/stores', storesRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);

let seeds: Awaited<ReturnType<typeof seedTestData>>;
let secondStoreId: number;

async function login(email: string, password = 'password123'): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password });
  return res.body.data.token as string;
}

beforeAll(async () => {
  seeds = await seedTestData();

  // Create a second store inline for testing access restrictions
  const { rows: [secondStore] } = await testPool.query(
    `INSERT INTO stores (company_id, name, code, max_staff) VALUES ($1, 'Milano Test', 'MIL-T1', 8) RETURNING id`,
    [seeds.acmeId],
  );
  secondStoreId = secondStore.id;

  await testPool.query('DELETE FROM login_attempts');
  await testPool.query('DELETE FROM audit_logs');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// GET /api/stores
// ---------------------------------------------------------------------------

describe('GET /api/stores', () => {
  it('admin sees all stores', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request.get('/api/stores').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Seed created romaStore + we created secondStore = at least 2
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('admin sees inactive stores after deactivation', async () => {
    const adminToken = await login('admin@acme-test.com');

    // Deactivate secondStore
    await request
      .delete(`/api/stores/${secondStoreId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request.get('/api/stores').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: any) => s.id);
    expect(ids).toContain(secondStoreId);

    // Restore for other tests
    await request
      .patch(`/api/stores/${secondStoreId}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  it('hr sees all stores', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request.get('/api/stores').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('area_manager can list stores when negozi row is missing (default-on)', async () => {
    await testPool.query(
      `DELETE FROM role_module_permissions
       WHERE company_id = $1 AND role = 'area_manager' AND module_name = 'negozi'`,
      [seeds.acmeId],
    );

    const token = await login('area@acme-test.com');
    const res = await request.get('/api/stores').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    // Restore defaults for other tests
    await testPool.query(
      `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
       VALUES ($1, 'area_manager', 'negozi', true)
       ON CONFLICT (company_id, role, module_name)
       DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
      [seeds.acmeId],
    );
  });

  it('store_manager sees only their own store (array length 1)', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request.get('/api/stores').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe(seeds.romaStoreId);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request.get('/api/stores');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:id
// ---------------------------------------------------------------------------

describe('GET /api/stores/:id', () => {
  it('admin gets any store by id', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get(`/api/stores/${seeds.romaStoreId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(seeds.romaStoreId);
  });

  it('store_manager gets their own store', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .get(`/api/stores/${seeds.romaStoreId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(seeds.romaStoreId);
  });

  it('store_manager gets 403 for a different store', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .get(`/api/stores/${secondStoreId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for nonexistent store', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/stores/999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/stores
// ---------------------------------------------------------------------------

describe('POST /api/stores', () => {
  it('admin creates a new store', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Napoli Store',
        code: 'NAP-T1',
        address: 'Via Toledo 1, Napoli',
        max_staff: 15,
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.code).toBe('NAP-T1');
    // Cleanup
    await testPool.query(`DELETE FROM stores WHERE code = 'NAP-T1' AND company_id = $1`, [seeds.acmeId]);
  });

  it('returns 409 with CODE CODE_CONFLICT for duplicate store code', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Roma Duplicate',
        code: 'ROM-T1', // already used by romaStore
        max_staff: 5,
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CODE_CONFLICT');
  });

  it('hr can create a store', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'HR Store',
        code: 'HR-T1',
        max_staff: 5,
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // Cleanup
    await testPool.query(`DELETE FROM stores WHERE code = 'HR-T1' AND company_id = $1`, [seeds.acmeId]);
  });

  it('store_manager gets 403 trying to create a store', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Manager Store',
        code: 'MGR-T1',
        max_staff: 5,
      });
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing name', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'NO-NAME',
        max_staff: 5,
      });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/stores/:id
// ---------------------------------------------------------------------------

describe('PUT /api/stores/:id', () => {
  it('admin updates store details', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put(`/api/stores/${seeds.romaStoreId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Roma Test Updated',
        code: 'ROM-T1', // same code — should be fine
        max_staff: 12,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Roma Test Updated');
    // Restore
    await testPool.query(
      `UPDATE stores SET name = 'Roma Test', max_staff = 10 WHERE id = $1`,
      [seeds.romaStoreId],
    );
  });

  it('same code on the same store is not a conflict (200)', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put(`/api/stores/${seeds.romaStoreId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Roma Test',
        code: 'ROM-T1',
        max_staff: 10,
      });
    expect(res.status).toBe(200);
  });

  it('returns 409 CODE_CONFLICT when code belongs to a different store', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put(`/api/stores/${seeds.romaStoreId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Roma Test',
        code: 'MIL-T1', // code used by secondStore
        max_staff: 10,
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CODE_CONFLICT');
  });

  it('returns 404 for nonexistent store', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put('/api/stores/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Ghost',
        code: 'GHOST',
        max_staff: 0,
      });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/stores/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/stores/:id', () => {
  it('admin deactivates a store (is_active becomes false)', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .delete(`/api/stores/${secondStoreId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  it('hr can deactivate a store', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request
      .delete(`/api/stores/${secondStoreId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
    // Restore
    const adminToken = await login('admin@acme-test.com');
    await request.patch(`/api/stores/${secondStoreId}/activate`).set('Authorization', `Bearer ${adminToken}`);
  });

  it('store_manager gets 403 trying to deactivate a store', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .delete(`/api/stores/${secondStoreId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/stores/:id/permanent
// ---------------------------------------------------------------------------

describe('DELETE /api/stores/:id/permanent — admin hard delete', () => {
  it('403 for store_manager (not a store writer)', async () => {
    const managerToken = await login('manager.roma@acme-test.com');
    const res = await request
      .delete(`/api/stores/${seeds.romaStoreId}/permanent`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
  });

  it('409 if store has employees', async () => {
    const adminToken = await login('admin@acme-test.com');
    const res = await request
      .delete(`/api/stores/${seeds.romaStoreId}/permanent`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STORE_HAS_EMPLOYEES');
  });

  it('200 deletes inactive store with no employees', async () => {
    const adminToken = await login('admin@acme-test.com');
    const createRes = await request.post('/api/stores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Temp Store', code: 'TMP-99', max_staff: 0 });
    const tmpId = createRes.body.data.id;
    await request.delete(`/api/stores/${tmpId}`).set('Authorization', `Bearer ${adminToken}`); // soft-delete
    const delRes = await request.delete(`/api/stores/${tmpId}/permanent`).set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);
    const getRes = await request.get(`/api/stores/${tmpId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:id/activate
// ---------------------------------------------------------------------------

describe('PATCH /api/stores/:id/activate', () => {
  it('admin reactivates a deactivated store', async () => {
    // Ensure secondStore is inactive (previous DELETE test should have done this,
    // but set it explicitly in case test order varies)
    await testPool.query(`UPDATE stores SET is_active = false WHERE id = $1`, [secondStoreId]);

    const token = await login('admin@acme-test.com');
    const res = await request
      .patch(`/api/stores/${secondStoreId}/activate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(true);
  });

  it('returns 404 when trying to activate an already active store', async () => {
    // Ensure romaStore is active
    await testPool.query(`UPDATE stores SET is_active = true WHERE id = $1`, [seeds.romaStoreId]);

    const token = await login('admin@acme-test.com');
    const res = await request
      .patch(`/api/stores/${seeds.romaStoreId}/activate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
