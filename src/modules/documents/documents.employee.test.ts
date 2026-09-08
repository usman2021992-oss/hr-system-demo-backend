import express from 'express';
import supertest from 'supertest';
import authRoutes from '../auth/auth.routes';
import documentsRoutes from './documents.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentsRoutes);
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
  await testPool.query('DELETE FROM login_attempts');
  await testPool.query('DELETE FROM audit_logs');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

describe('GET /api/documents/employee/:employeeId', () => {
  it('area_manager can open employee documents for an employee in visible scope', async () => {
    const token = await login('area@acme-test.com');
    const res = await request
      .get(`/api/documents/employee/${seeds.employee1Id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
