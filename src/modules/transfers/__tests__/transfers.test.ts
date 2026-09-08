import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import shiftsRoutes from '../../shifts/shifts.routes';
import transfersRoutes from '../transfers.routes';
import { clearTestData, closeTestDb, seedTestData, testPool } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/transfers', transfersRoutes);
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

  const { rows: [store] } = await testPool.query(
    `INSERT INTO stores (company_id, name, code, max_staff, is_active)
     VALUES ($1, 'Milano Test', 'MIL-T2', 8, true)
     ON CONFLICT (company_id, code)
     DO UPDATE SET name = EXCLUDED.name, max_staff = EXCLUDED.max_staff, is_active = true
     RETURNING id`,
    [seeds.acmeId],
  );
  secondStoreId = store.id;
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

describe('Transfers + shifts integration', () => {
  it('blocks cross-store shift creation without active transfer', async () => {
    const token = await login('admin@acme-test.com');

    const res = await request
      .post('/api/shifts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: seeds.employee1Id,
        store_id: secondStoreId,
        date: '2030-01-15',
        start_time: '09:00',
        end_time: '17:00',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TRANSFER_REQUIRED');
  });

  it('allows cross-store shift creation when active transfer exists and links assignment_id', async () => {
    const token = await login('admin@acme-test.com');

    const transferRes = await request
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: seeds.employee1Id,
        origin_store_id: seeds.romaStoreId,
        target_store_id: secondStoreId,
        start_date: '2030-01-16',
        end_date: '2030-01-16',
        reason: 'Supporto punto vendita',
      });

    expect(transferRes.status).toBe(201);
    expect(transferRes.body.success).toBe(true);
    const transferId = transferRes.body.data.transfer.id as number;

    const shiftRes = await request
      .post('/api/shifts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: seeds.employee1Id,
        store_id: secondStoreId,
        date: '2030-01-16',
        start_time: '09:00',
        end_time: '17:00',
      });

    expect(shiftRes.status).toBe(201);
    expect(shiftRes.body.success).toBe(true);
    expect(shiftRes.body.data.assignment_id).toBe(transferId);
  });

  it('returns overlap conflict when creating a second active overlapping transfer', async () => {
    const token = await login('admin@acme-test.com');

    const res = await request
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: seeds.employee1Id,
        origin_store_id: seeds.romaStoreId,
        target_store_id: secondStoreId,
        start_date: '2030-01-16',
        end_date: '2030-01-17',
        reason: 'Tentativo duplicato',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TRANSFER_OVERLAP');
  });
});
