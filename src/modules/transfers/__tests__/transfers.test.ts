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

// ---------------------------------------------------------------------------
// Company filter + who may be transferred
// ---------------------------------------------------------------------------

describe('GET /api/transfers company filter', () => {
  let outsideCompanyId: number;

  beforeAll(async () => {
    const { rows: [outside] } = await testPool.query<{ id: number }>(
      `INSERT INTO companies (name, slug) VALUES ('Delta Test', 'delta-test')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );
    outsideCompanyId = outside.id;
  });

  it('returns only the transfers of the requested company', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/transfers')
      .query({ company_id: String(seeds.acmeId) })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const transfers: any[] = res.body.data.transfers;
    expect(transfers.length).toBeGreaterThan(0);
    transfers.forEach((tr) => expect(tr.company_id).toBe(seeds.acmeId));
  });

  it('returns nothing for a company in scope that has no transfers', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/transfers')
      .query({ company_id: String(seeds.betaId) })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transfers).toEqual([]);
  });

  it('rejects a company the caller may not see', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/transfers')
      .query({ company_id: String(outsideCompanyId) })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMPANY_MISMATCH');
  });
});

describe('POST /api/transfers subject roles', () => {
  it('transfers a store manager, not only plain employees', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: seeds.romaManagerId,
        origin_store_id: seeds.romaStoreId,
        target_store_id: secondStoreId,
        start_date: '2030-03-01',
        end_date: '2030-03-05',
        reason: 'Copertura direzione negozio',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.transfer.user_id).toBe(seeds.romaManagerId);
  });

  it('transfers an HR user when an origin store is given explicitly', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: seeds.hrId,
        origin_store_id: seeds.romaStoreId,
        target_store_id: secondStoreId,
        start_date: '2030-04-01',
        end_date: '2030-04-02',
        reason: 'Affiancamento',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.transfer.user_id).toBe(seeds.hrId);
  });

  it('refuses to transfer an admin', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: seeds.adminId,
        origin_store_id: seeds.romaStoreId,
        target_store_id: secondStoreId,
        start_date: '2030-05-01',
        end_date: '2030-05-02',
      });

    expect(res.status).toBe(404);
  });

  it('refuses to transfer a store terminal', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: seeds.terminalId,
        origin_store_id: seeds.romaStoreId,
        target_store_id: secondStoreId,
        start_date: '2030-06-01',
        end_date: '2030-06-02',
      });

    expect(res.status).toBe(404);
  });
});
