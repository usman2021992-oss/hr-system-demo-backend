import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import companiesRoutes from '../companies.routes';
import { seedTestData, clearTestData, closeTestDb } from '../../../__tests__/helpers/db';
import { query } from '../../../config/database';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);
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

describe('GET /api/companies', () => {
  it('admin gets array containing their company with storeCount and employeeCount', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/companies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const company = res.body.data[0];
    expect(company.id).toBe(seeds.acmeId);
    expect(typeof company.store_count).toBe('number');
    expect(typeof company.employee_count).toBe('number');
    expect(company.store_count).toBeGreaterThanOrEqual(1);
    expect(company.employee_count).toBeGreaterThanOrEqual(1);
  });

  it('hr returns 200 and can list scoped companies', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/companies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('area_manager returns 200 and can list scoped companies', async () => {
    const token = await loginAs('area@acme-test.com');
    const res = await request.get('/api/companies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('admin returns grouped cross-company list', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/companies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = res.body.data.map((c: any) => c.id);
    expect(ids).toEqual(expect.arrayContaining([seeds.acmeId, seeds.betaId]));
  });

  it('grouped roles still see active sibling companies after sibling access end date passes', async () => {
    await query(
      `UPDATE companies
       SET access_valid_to = $1
       WHERE id = $2`,
      ['2026-05-30', seeds.betaId],
    );

    const [adminToken, hrToken, areaToken] = await Promise.all([
      loginAs('admin@acme-test.com'),
      loginAs('hr@acme-test.com'),
      loginAs('area@acme-test.com'),
    ]);

    const [adminRes, hrRes, areaRes] = await Promise.all([
      request.get('/api/companies').set('Authorization', `Bearer ${adminToken}`),
      request.get('/api/companies').set('Authorization', `Bearer ${hrToken}`),
      request.get('/api/companies').set('Authorization', `Bearer ${areaToken}`),
    ]);

    for (const res of [adminRes, hrRes, areaRes]) {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const ids = res.body.data.map((c: any) => c.id);
      expect(ids).toEqual(expect.arrayContaining([seeds.acmeId, seeds.betaId]));
    }
  });

  it('unauthenticated returns 401', async () => {
    const res = await request.get('/api/companies');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/companies/:id', () => {
  it('admin updates company name successfully, response has new name and derived slug', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put(`/api/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Updated Corp' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Acme Updated Corp');
    expect(res.body.data.slug).toBe('acme-updated-corp');

    await request
      .put(`/api/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Test' });
  });

  it('admin can update a different company id', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put(`/api/companies/${seeds.betaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hijacked Company' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Hijacked Company');
    expect(res.body.data.slug).toBe('hijacked-company');

    await request
      .put(`/api/companies/${seeds.betaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Beta Test' });
  });

  it('empty name returns 400', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put(`/api/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('hr can update company within group scope', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .put(`/api/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'HR Attempt' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.slug).toBe('hr-attempt');
  });
});

describe('POST /api/companies', () => {
  it('super admin creates a company', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .post('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Company X' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('New Company X');
    expect(res.body.data.slug).toBe('new-company-x');

    const listRes = await request.get('/api/companies').set('Authorization', `Bearer ${token}`);
    expect(listRes.body.data.map((c: any) => c.id)).toEqual(
      expect.arrayContaining([res.body.data.id]),
    );
  });

  it('super admin can assign an active admin owner while creating a company', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .post('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Owner Company X', owner_user_id: seeds.adminId });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Owner Company X');
    expect(res.body.data.owner_user_id).toBe(seeds.adminId);
  });

  it('hr cannot create a company', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .post('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Should Fail' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
