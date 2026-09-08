import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import permissionsRoutes from '../permissions.routes';
import { seedTestData, clearTestData, closeTestDb } from '../../../__tests__/helpers/db';

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

describe('POST /api/auth/login as super admin', () => {
  it('super admin can log in', async () => {
    const res = await request.post('/api/auth/login').send({ email: 'superadmin@acme-test.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.role).toBe('admin');
  });
});

describe('GET /api/permissions/my as admin', () => {
  it('returns active modules based on stored toggles', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/permissions/my').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dipendenti).toBe(true);
    expect(res.body.data.turni).toBe(true);
    expect(res.body.data.negozi).toBe(true);
  });
});

describe('GET /api/permissions/companies', () => {
  it('super admin gets all companies with grid', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request.get('/api/permissions/companies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.companies)).toBe(true);
    const company = res.body.data.companies.find((c: { id: number }) => c.id === seeds.acmeId);
    expect(company).toBeDefined();
    expect(company.grid).toHaveProperty('turni');
    expect(company.grid).toHaveProperty('impostazioni');
    expect(company.grid.turni).toHaveProperty('hr');
  });

  it('hr → 403', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/permissions/companies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const res = await request.get('/api/permissions/companies');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/permissions/companies/:companyId', () => {
  it('admin can update a permission', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'negozi', enabled: false }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify persisted
    const getRes = await request.get('/api/permissions/companies').set('Authorization', `Bearer ${token}`);
    const company = getRes.body.data.companies.find((c: { id: number }) => c.id === seeds.acmeId);
    expect(company.grid.negozi.hr).toBe(false);

    // Restore
    await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'negozi', enabled: true }] });
  });

  it('employee can update a company permission', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'employee', module: 'turni', enabled: false }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify persisted
    const getRes = await request.get('/api/permissions/companies').set('Authorization', `Bearer ${token}`);
    const company = getRes.body.data.companies.find((c: { id: number }) => c.id === seeds.acmeId);
    expect(company.grid.turni.employee).toBe(false);

    // Restore
    await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'employee', module: 'turni', enabled: true }] });
  });

  it('store_terminal can update a company permission', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'store_terminal', module: 'presenze', enabled: false }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify persisted
    const getRes = await request.get('/api/permissions/companies').set('Authorization', `Bearer ${token}`);
    const company = getRes.body.data.companies.find((c: { id: number }) => c.id === seeds.acmeId);
    expect(company.grid.presenze.store_terminal).toBe(false);

    // Restore
    await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'store_terminal', module: 'presenze', enabled: true }] });
  });

  it('admin role can now be managed in system permissions', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'admin', module: 'turni', enabled: false }] });
    expect(res.status).toBe(200);

    await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'admin', module: 'turni', enabled: true }] });
  });

  it('invalid module → 400', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'report', enabled: false }] });
    expect(res.status).toBe(400);
  });

  it('ineligible role-module combo (employee + negozi) → 400 ROLE_NOT_ELIGIBLE', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'employee', module: 'negozi', enabled: true }] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('ROLE_NOT_ELIGIBLE');
  });

  it('non-existent companyId → 404', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .put('/api/permissions/companies/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'turni', enabled: false }] });
    expect(res.status).toBe(404);
  });

  it('hr → 403', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [{ role: 'hr', module: 'turni', enabled: false }] });
    expect(res.status).toBe(403);
  });

  it('empty updates → 400', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .put(`/api/permissions/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ updates: [] });
    expect(res.status).toBe(400);
  });
});
