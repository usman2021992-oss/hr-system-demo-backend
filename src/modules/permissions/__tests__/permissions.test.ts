import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import permissionsRoutes from '../permissions.routes';
import { seedTestData, clearTestData, closeTestDb } from '../../../__tests__/helpers/db';
import { query } from '../../../config/database';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);

let seeds: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => {
  seeds = await seedTestData();
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

async function loginAs(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token;
}

describe('GET /api/permissions', () => {
  it('admin gets { grid, moduleMeta } with dipendenti and impostazioni keys', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/permissions').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.grid).toBeDefined();
    expect(res.body.data.moduleMeta).toBeDefined();
    expect(res.body.data.grid).toHaveProperty('dipendenti');
    expect(res.body.data.grid).toHaveProperty('impostazioni');
    expect(res.body.data.moduleMeta.dipendenti).toEqual({ active: true });
    expect(res.body.data.moduleMeta.turni).toEqual({ active: true });
    expect(res.body.data.moduleMeta.presenze).toEqual({ active: true });
    expect(res.body.data.moduleMeta.permessi).toEqual({ active: true });
    expect(res.body.data.moduleMeta.impostazioni).toEqual({ active: true });
  });

  it('hr can access permissions grid', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/permissions').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('unauthenticated → 401', async () => {
    const res = await request.get('/api/permissions');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/permissions', () => {
  it('admin can toggle dipendenti for hr role', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'dipendenti', enabled: false }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the change was persisted via GET /my as hr
    const hrToken = await loginAs('hr@acme-test.com');
    const myRes = await request.get('/api/permissions/my').set('Authorization', `Bearer ${hrToken}`);
    expect(myRes.status).toBe(200);
    expect(myRes.body.data.dipendenti).toBe(false);

    // Restore the original value
    await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'dipendenti', enabled: true }] });
  });

  it('active module (turni) → 200 now that turni is in ACTIVE_MODULES', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'turni', enabled: true }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('non-active module (documenti) → 400 with code MODULE_NOT_ACTIVE', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'documenti', enabled: true }] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('MODULE_NOT_ACTIVE');
  });

  it('ineligible role-module combo (employee + dipendenti) → 400 ROLE_NOT_ELIGIBLE', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'employee', module: 'dipendenti', enabled: true }] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('ROLE_NOT_ELIGIBLE');
  });

  it('empty updates array → 400', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('hr can update permissions', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'employee', module: 'turni', enabled: false }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Restore
    await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'employee', module: 'turni', enabled: true }] });
  });

  it('unauthenticated → 401', async () => {
    const res = await request
      .put('/api/permissions')
      .send({ updates: [{ role: 'hr', module: 'dipendenti', enabled: false }] });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/permissions/my', () => {
  it('admin gets their own permissions map with dipendenti: true', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('dipendenti');
    expect(res.body.data.dipendenti).toBe(true);
    expect(res.body.data.impostazioni).toBe(true);
  });

  it('hr has impostazioni enabled when configured', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.impostazioni).toBe(true);
  });

  it('hr gets their own permissions map', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('dipendenti');
  });

  it('employee gets their own permissions (dipendenti: false)', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dipendenti).toBe(false);
  });

  it('unauthenticated → 401', async () => {
    const res = await request.get('/api/permissions/my');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('messaggi defaults to true for eligible roles when DB row is missing', async () => {
    await query(
      `DELETE FROM role_module_permissions
       WHERE company_id = $1 AND role = 'hr' AND module_name = 'messaggi'`,
      [seeds.acmeId],
    );
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.messaggi).toBe(true);
  });

  it('negozi defaults to true for area_manager when DB row is missing', async () => {
    await query(
      `DELETE FROM role_module_permissions
       WHERE company_id = $1 AND role = 'area_manager' AND module_name = 'negozi'`,
      [seeds.acmeId],
    );
    const token = await loginAs('area@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.negozi).toBe(true);
  });

  it('negozi defaults to true for hr when DB row is missing', async () => {
    await query(
      `DELETE FROM role_module_permissions
       WHERE company_id = $1 AND role = 'hr' AND module_name = 'negozi'`,
      [seeds.acmeId],
    );
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.negozi).toBe(true);
  });

  it('impostazioni defaults to true for admin when DB row is missing', async () => {
    await query(
      `DELETE FROM role_module_permissions
       WHERE company_id = $1 AND role = 'admin' AND module_name = 'impostazioni'`,
      [seeds.acmeId],
    );
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.impostazioni).toBe(true);
  });
});

describe('GET /api/permissions/effective', () => {
  it('returns effective module map with role and target company', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/permissions/effective').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('admin');
    expect(Array.isArray(res.body.data.allowedCompanyIds)).toBe(true);
    expect(res.body.data.modules).toHaveProperty('dipendenti');
    expect(res.body.data.modules.dipendenti).toBe(true);
    expect(typeof res.body.data.modules.turni).toBe('boolean');
  });

  it('super admin can switch target company', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .get(`/api/permissions/effective?target_company_id=${seeds.betaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.targetCompanyId).toBe(seeds.betaId);
  });
});

describe('target_company_id scope semantics', () => {
  it('admin updatePermissions only affects selected target company', async () => {
    const token = await loginAs('admin@acme-test.com');
    const disableRes = await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ target_company_id: seeds.acmeId, updates: [{ role: 'hr', module: 'negozi', enabled: false }] });
    expect(disableRes.status).toBe(200);

    const acmeGrid = await request
      .get(`/api/permissions?target_company_id=${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`);
    const betaGrid = await request
      .get(`/api/permissions?target_company_id=${seeds.betaId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(acmeGrid.status).toBe(200);
    expect(betaGrid.status).toBe(200);
    expect(acmeGrid.body.data.grid.negozi.hr).toBe(false);
    expect(betaGrid.body.data.grid.negozi.hr).toBe(true);

    await request
      .put('/api/permissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ target_company_id: seeds.acmeId, updates: [{ role: 'hr', module: 'negozi', enabled: true }] });
  });

  it('rejects invalid explicit target_company_id instead of fallback', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .get('/api/permissions?target_company_id=999999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('COMPANY_MISMATCH');
  });
});
