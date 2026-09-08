import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import homeRoutes from '../home.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/home', homeRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);

let seeds: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => {
  seeds = await seedTestData();
  // store_terminal user 'terminal@acme-test.com' is now created by seedTestData()
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

async function loginAs(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token;
}

describe('GET /api/home', () => {
  it('admin: has stats with companies/activeStores/activeEmployees as numbers, roleBreakdown array, storeBreakdown array', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/home').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(data.stats).toBeDefined();
    expect(typeof data.stats.companies).toBe('number');
    expect(typeof data.stats.activeStores).toBe('number');
    expect(typeof data.stats.activeEmployees).toBe('number');
    expect(Array.isArray(data.roleBreakdown)).toBe(true);
    expect(Array.isArray(data.storeBreakdown)).toBe(true);
  });

  it('hr: has expiringContracts array, newHires array, totalEmployees number, monthlyHires array, statusBreakdown array', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/home').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(Array.isArray(data.expiringContracts)).toBe(true);
    expect(Array.isArray(data.newHires)).toBe(true);
    expect(typeof data.totalEmployees).toBe('number');
    expect(Array.isArray(data.monthlyHires)).toBe(true);
    expect(Array.isArray(data.statusBreakdown)).toBe(true);
  });

  it('area_manager: has assignedStores array', async () => {
    const token = await loginAs('area@acme-test.com');
    const res = await request.get('/api/home').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.assignedStores)).toBe(true);
  });

  it('store_manager: has store object with id/name/code/maxStaff and employeeCount number', async () => {
    const token = await loginAs('manager.roma@acme-test.com');
    const res = await request.get('/api/home').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(data.store).toBeDefined();
    expect(data.store.id).toBeDefined();
    expect(data.store.name).toBeDefined();
    expect(data.store.code).toBeDefined();
    expect(data.store.max_staff).toBeDefined();
    expect(typeof data.employeeCount).toBe('number');
  });

  it('employee: has profile object with id/name/surname/role', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request.get('/api/home').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { profile } = res.body.data;
    expect(profile).toBeDefined();
    expect(profile.id).toBeDefined();
    expect(profile.name).toBeDefined();
    expect(profile.surname).toBeDefined();
    expect(profile.role).toBeDefined();
  });

  it('store_terminal: has store object with id/name/code', async () => {
    const token = await loginAs('terminal@acme-test.com');
    const res = await request.get('/api/home').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { store } = res.body.data;
    expect(store).toBeDefined();
    expect(store.id).toBeDefined();
    expect(store.name).toBeDefined();
    expect(store.code).toBeDefined();
  });

  it('unauthenticated → 401', async () => {
    const res = await request.get('/api/home');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
