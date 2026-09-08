import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import windowDisplayRoutes from '../window-display.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/window-display', windowDisplayRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;
let adminToken: string;
let areaToken: string;
let superAdminToken: string;
let scopedSuperAdminToken: string;
let betaStoreId: number;
let createdId: number;

async function login(email: string, password = 'password123'): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password });
  return res.body.data.token as string;
}

beforeAll(async () => {
  seeds = await seedTestData();

  const HASH = '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG'; // password123

  const betaStore = await testPool.query<{ id: number }>(
    `INSERT INTO stores (company_id, name, code, max_staff)
     VALUES ($1, 'Milano Beta', 'BET-MI', 8)
     ON CONFLICT (company_id, code)
     DO UPDATE SET name = EXCLUDED.name, max_staff = EXCLUDED.max_staff
     RETURNING id`,
    [seeds.betaId],
  );
  betaStoreId = betaStore.rows[0].id;

  await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status, is_super_admin)
     VALUES ($1, 'Scoped', 'Super Admin', 'superadmin.scoped@acme-test.com', $2, 'admin', 'active', true)
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       is_super_admin = EXCLUDED.is_super_admin`,
    [seeds.acmeId, HASH],
  );

  adminToken = await login('admin@acme-test.com');
  areaToken = await login('area@acme-test.com');
  superAdminToken = await login('superadmin@acme-test.com');
  scopedSuperAdminToken = await login('superadmin.scoped@acme-test.com');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// GET /api/window-display
// ---------------------------------------------------------------------------

describe('GET /api/window-display', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request.get('/api/window-display').query({ store_id: 1, month: '2026-04' });
    expect(res.status).toBe(401);
  });

  it('returns month mapping list when store_id is omitted', async () => {
    const res = await request
      .get('/api/window-display')
      .query({ month: '2026-04' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 400 when month format is invalid', async () => {
    const res = await request
      .get('/api/window-display')
      .query({ store_id: seeds.romaStoreId, month: '04-2026' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns an empty array when no activity exists for the store/month', async () => {
    const res = await request
      .get('/api/window-display')
      .query({ store_id: seeds.romaStoreId, month: '2026-04' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/window-display
// ---------------------------------------------------------------------------

describe('POST /api/window-display', () => {
  it('returns 403 for store_manager role', async () => {
    const storeManagerToken = await login('manager.roma@acme-test.com');
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${storeManagerToken}`)
      .send({ store_id: seeds.romaStoreId, date: '2026-04-15' });
    expect(res.status).toBe(403);
  });

  it('admin can create a window display activity', async () => {
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        store_id: seeds.romaStoreId,
        date: '2026-04-15',
        activity_type: 'window_display',
        activity_icon: '*',
        duration_hours: 3,
        notes: 'Main facade refresh',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.date).toBe('2026-04-15');
    expect(res.body.data.year_month).toBe('2026-04');
    expect(res.body.data.store_id).toBe(seeds.romaStoreId);
    expect(res.body.data.activity_type).toBe('window_display');
    expect(res.body.data.activity_icon).toBe('*');
    expect(res.body.data.custom_activity_name).toBeNull();
    expect(Number(res.body.data.duration_hours)).toBe(3);
    expect(res.body.data.notes).toBe('Main facade refresh');
    createdId = res.body.data.id;
  });

  it('returns activity mapping list for the month', async () => {
    const res = await request
      .get('/api/window-display')
      .query({ month: '2026-04' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].store_name).toBeDefined();
  });

  it('allows a second activity in the same month on a different date', async () => {
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${areaToken}`)
      .send({ store_id: seeds.romaStoreId, date: '2026-04-20' });
    expect(res.status).toBe(201);
    expect(res.body.data.date).toBe('2026-04-20');

    // Clean up so later store/month assertions stay deterministic.
    await request
      .delete(`/api/window-display/${res.body.data.id}`)
      .set('Authorization', `Bearer ${areaToken}`);
  });

  it('returns 409 when creating a second activity on the same date for a store', async () => {
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${areaToken}`)
      .send({ store_id: seeds.romaStoreId, date: '2026-04-15' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WINDOW_DISPLAY_ALREADY_SET');
  });

  it('returns 400 when custom_activity_name is missing for custom_activity', async () => {
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        store_id: seeds.romaStoreId,
        date: '2026-09-03',
        activity_type: 'custom_activity',
      });

    expect(res.status).toBe(400);
  });

  it('super_admin can create activity without explicit company_id', async () => {
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        store_id: seeds.romaStoreId,
        date: '2026-05-11',
        activity_type: 'store_cleaning',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.company_id).toBe(seeds.acmeId);
    expect(res.body.data.activity_type).toBe('store_cleaning');
  });

  it('admin can create activity in another allowed company when company_id is provided', async () => {
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        company_id: seeds.betaId,
        store_id: betaStoreId,
        date: '2026-07-11',
        activity_type: 'store_reset',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.company_id).toBe(seeds.betaId);
    expect(res.body.data.store_id).toBe(betaStoreId);
  });

  it('super_admin with a home company can create cross-company activity without explicit company_id', async () => {
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${scopedSuperAdminToken}`)
      .send({
        store_id: betaStoreId,
        date: '2026-08-11',
        activity_type: 'store_cleaning',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.company_id).toBe(seeds.betaId);
    expect(res.body.data.store_id).toBe(betaStoreId);
  });

  it('admin can create custom activity with custom_activity_name', async () => {
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        company_id: seeds.betaId,
        store_id: betaStoreId,
        date: '2026-09-17',
        activity_type: 'custom_activity',
        custom_activity_name: 'VIP private fitting',
        activity_icon: '🧵',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.activity_type).toBe('custom_activity');
    expect(res.body.data.custom_activity_name).toBe('VIP private fitting');
    expect(res.body.data.activity_icon).toBe('🧵');
  });

  it('creates one activity per date via the dates[] batch and reports skipped duplicates', async () => {
    const first = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ store_id: seeds.romaStoreId, dates: ['2026-06-01', '2026-06-02', '2026-06-03'], activity_type: 'store_cleaning' });
    expect(first.status).toBe(201);
    expect(Array.isArray(first.body.data.created)).toBe(true);
    expect(first.body.data.created.length).toBe(3);
    expect(first.body.data.skipped).toEqual([]);

    // Re-submitting overlapping dates skips the taken ones and creates only the new date.
    const second = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ store_id: seeds.romaStoreId, dates: ['2026-06-02', '2026-06-04'], activity_type: 'store_cleaning' });
    expect(second.status).toBe(201);
    expect(second.body.data.created.length).toBe(1);
    expect(second.body.data.created[0].date).toBe('2026-06-04');
    expect(second.body.data.skipped).toEqual(['2026-06-02']);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/window-display/:id
// ---------------------------------------------------------------------------

describe('PUT /api/window-display/:id', () => {
  it('area_manager can update activity details', async () => {
    const res = await request
      .put(`/api/window-display/${createdId}`)
      .set('Authorization', `Bearer ${areaToken}`)
      .send({
        date: '2026-04-22',
        activity_type: 'decoration_renovation',
        activity_icon: '@',
        duration_hours: 4,
        notes: 'Spring promo showcase',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe('2026-04-22');
    expect(res.body.data.year_month).toBe('2026-04');
    expect(res.body.data.activity_type).toBe('decoration_renovation');
    expect(res.body.data.activity_icon).toBe('@');
    expect(Number(res.body.data.duration_hours)).toBe(4);
    expect(res.body.data.notes).toBe('Spring promo showcase');
  });

  it('area_manager can switch to custom_activity with a custom name', async () => {
    const res = await request
      .put(`/api/window-display/${createdId}`)
      .set('Authorization', `Bearer ${areaToken}`)
      .send({
        activity_type: 'custom_activity',
        custom_activity_name: 'Client private event setup',
        activity_icon: '🎉',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.activity_type).toBe('custom_activity');
    expect(res.body.data.custom_activity_name).toBe('Client private event setup');
    expect(res.body.data.activity_icon).toBe('🎉');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/window-display/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/window-display/:id', () => {
  it('area_manager can delete the activity', async () => {
    const delRes = await request
      .delete(`/api/window-display/${createdId}`)
      .set('Authorization', `Bearer ${areaToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.deleted).toBe(true);

    const getAfter = await request
      .get('/api/window-display')
      .query({ store_id: seeds.romaStoreId, month: '2026-04' })
      .set('Authorization', `Bearer ${areaToken}`);
    expect(Array.isArray(getAfter.body.data)).toBe(true);
    expect(getAfter.body.data.length).toBe(0);
  });
});
