import supertest from 'supertest';
import express from 'express';
import authRoutes from '../../auth/auth.routes';
import searchRoutes from '../search.routes';
import { testPool, clearTestData, seedTestData, closeTestDb } from '../../../__tests__/helpers/db';
import { pool } from '../../../config/database';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/search', searchRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message });
});

const request = supertest(app);

let superAdminToken: string;
let adminToken: string;
let employeeToken: string;

async function login(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data?.token ?? '';
}

beforeAll(async () => {
  await seedTestData();
  superAdminToken = await login('superadmin@acme-test.com');
  adminToken = await login('admin@acme-test.com');
  employeeToken = await login('employee1@acme-test.com');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
  await pool.end();
});

describe('Global Search API', () => {
  it('should reject requests with missing token (401)', async () => {
    const res = await request.get('/api/search?q=test');
    expect(res.status).toBe(401);
  });

  it('should reject requests from non-admin users (403)', async () => {
    const res = await request
      .get('/api/search?q=test')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  it('should allow super admin to search and return empty results when query too short', async () => {
    const res = await request
      .get('/api/search?q=a')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.employees).toHaveLength(0);
  });

  it('should return search results for employees when query is valid', async () => {
    const res = await request
      .get('/api/search?q=Admin')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.employees).toBeDefined();
    expect(res.body.data.employees.length).toBeGreaterThan(0);
    expect(res.body.data.employees[0].name).toBe('Admin');
  });

  it('should allow regular admin to search company scoped users', async () => {
    const res = await request
      .get('/api/search?q=Admin')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.employees).toBeDefined();
    expect(res.body.data.employees.length).toBeGreaterThan(0);
  });
});
