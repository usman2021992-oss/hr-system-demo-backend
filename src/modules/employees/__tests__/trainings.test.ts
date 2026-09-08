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
let createdTrainingId: number;

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

// ---------------------------------------------------------------------------
// GET /api/employees/:id/trainings
// ---------------------------------------------------------------------------

describe('GET /api/employees/:id/trainings', () => {
  it('admin can list trainings for any employee', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.employee1Id}/trainings`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('hr can list trainings for any employee', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.employee1Id}/trainings`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('employee cannot view another employee trainings (403)', async () => {
    // employee1 tries to view admin trainings
    const token = await login('employee1@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.adminId}/trainings`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('employee can view their own trainings', async () => {
    const token = await login('employee1@acme-test.com');
    const res = await request
      .get(`/api/employees/${seeds.employee1Id}/trainings`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request.get(`/api/employees/${seeds.employee1Id}/trainings`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/employees/:id/trainings
// ---------------------------------------------------------------------------

describe('POST /api/employees/:id/trainings', () => {
  it('admin can create a training record (201)', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/trainings`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        training_type: 'general',
        start_date: '2025-01-01',
        end_date: '2026-01-01',
        notes: 'Test training',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.training_type).toBe('general');
    createdTrainingId = res.body.data.id;
  });

  it('hr can create a training record (201)', async () => {
    const token = await login('hr@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/trainings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ training_type: 'product', start_date: '2025-02-01', end_date: '2026-02-01' });
    expect(res.status).toBe(201);
  });

  it('employee cannot create trainings (403)', async () => {
    const token = await login('employee1@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/trainings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ training_type: 'general' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid training_type (400)', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/trainings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ training_type: 'invalid_type' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/employees/:id/trainings/:trainingId
// ---------------------------------------------------------------------------

describe('PUT /api/employees/:id/trainings/:trainingId', () => {
  it('admin can update a training record (200)', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put(`/api/employees/${seeds.employee1Id}/trainings/${createdTrainingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        training_type: 'general',
        start_date: '2025-01-15',
        end_date: '2026-01-15',
        notes: 'Updated notes',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Updated notes');
  });

  it('returns 404 for non-existent training', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .put(`/api/employees/${seeds.employee1Id}/trainings/99999`)
      .set('Authorization', `Bearer ${token}`)
      .send({ training_type: 'general', start_date: null, end_date: null });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/employees/:id/trainings/:trainingId
// ---------------------------------------------------------------------------

describe('DELETE /api/employees/:id/trainings/:trainingId', () => {
  it('admin can delete a training record (200)', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .delete(`/api/employees/${seeds.employee1Id}/trainings/${createdTrainingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdTrainingId);
  });

  it('returns 404 after deletion', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .delete(`/api/employees/${seeds.employee1Id}/trainings/${createdTrainingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
