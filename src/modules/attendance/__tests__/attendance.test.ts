import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import qrRoutes from '../qr.routes';
import attendanceRoutes from '../attendance.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/attendance', attendanceRoutes);
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

async function cleanAttendance(): Promise<void> {
  await testPool.query('DELETE FROM attendance_events');
  await testPool.query('DELETE FROM qr_tokens');
}

// ---------------------------------------------------------------------------
// GET /api/qr/generate
// ---------------------------------------------------------------------------

describe('GET /api/qr/generate', () => {
  afterEach(async () => {
    await cleanAttendance();
  });

  it('returns token + nonce for store_manager', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .get('/api/qr/generate')
      .query({ store_id: seeds.romaStoreId })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe('string');
    expect(typeof res.body.data.nonce).toBe('string');
    expect(res.body.data.store_id).toBe(seeds.romaStoreId);
    expect(res.body.data.token_id).toBeGreaterThan(0);
  });

  it('returns 400 if store_id is missing', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .get('/api/qr/generate')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for employee role', async () => {
    const token = await login('employee1@acme-test.com');
    const res = await request
      .get('/api/qr/generate')
      .query({ store_id: seeds.romaStoreId })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/attendance/checkin
// ---------------------------------------------------------------------------

describe('POST /api/attendance/checkin', () => {
  let qrToken: string;

  beforeEach(async () => {
    await cleanAttendance();
    // Generate a fresh QR token as the store manager
    const managerAuthToken = await login('manager.roma@acme-test.com');
    const genRes = await request
      .get('/api/qr/generate')
      .query({ store_id: seeds.romaStoreId })
      .set('Authorization', `Bearer ${managerAuthToken}`);
    qrToken = genRes.body.data.token;
  });

  afterEach(async () => {
    await cleanAttendance();
  });

  it('checkin with valid QR token returns 201', async () => {
    const managerAuthToken = await login('manager.roma@acme-test.com');
    const res = await request
      .post('/api/attendance/checkin')
      .set('Authorization', `Bearer ${managerAuthToken}`)
      .send({
        qr_token: qrToken,
        event_type: 'checkin',
        user_id: seeds.employee1Id,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.event_type).toBe('checkin');
    expect(res.body.data.user_id).toBe(seeds.employee1Id);
    expect(res.body.data.source).toBe('qr');
  });

  it('replay prevention: same token returns 409', async () => {
    const managerAuthToken = await login('manager.roma@acme-test.com');

    // First use — should succeed
    await request
      .post('/api/attendance/checkin')
      .set('Authorization', `Bearer ${managerAuthToken}`)
      .send({
        qr_token: qrToken,
        event_type: 'checkin',
        user_id: seeds.employee1Id,
      });

    // Second use with same token — should fail with 409
    const res = await request
      .post('/api/attendance/checkin')
      .set('Authorization', `Bearer ${managerAuthToken}`)
      .send({
        qr_token: qrToken,
        event_type: 'checkout',
        user_id: seeds.employee1Id,
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('QR_ALREADY_USED');
  });

  it('invalid/tampered token returns 400', async () => {
    const managerAuthToken = await login('manager.roma@acme-test.com');
    const res = await request
      .post('/api/attendance/checkin')
      .set('Authorization', `Bearer ${managerAuthToken}`)
      .send({
        qr_token: 'this.is.not.a.valid.jwt',
        event_type: 'checkin',
        user_id: seeds.employee1Id,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INVALID_QR_TOKEN');
  });

  it('returns 403 when presenze module is disabled for employee role', async () => {
    await testPool.query(
      `UPDATE role_module_permissions
       SET is_enabled = false
       WHERE company_id = $1 AND role = 'employee' AND module_name = 'presenze'`,
      [seeds.acmeId],
    );

    const employeeToken = await login('employee1@acme-test.com');
    const res = await request
      .post('/api/attendance/checkin')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        qr_token: qrToken,
        event_type: 'checkin',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('MODULE_DISABLED');

    await testPool.query(
      `UPDATE role_module_permissions
       SET is_enabled = true
       WHERE company_id = $1 AND role = 'employee' AND module_name = 'presenze'`,
      [seeds.acmeId],
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/attendance
// ---------------------------------------------------------------------------

describe('GET /api/attendance', () => {
  beforeAll(async () => {
    await cleanAttendance();
    // Seed one attendance event directly for list tests
    await testPool.query(
      `INSERT INTO qr_tokens (company_id, store_id, nonce) VALUES ($1, $2, 'test-nonce-seed')`,
      [seeds.acmeId, seeds.romaStoreId],
    );
    const { rows: [qt] } = await testPool.query(
      `SELECT id FROM qr_tokens WHERE nonce = 'test-nonce-seed'`,
    );
    await testPool.query(
      `INSERT INTO attendance_events (company_id, store_id, user_id, event_type, source, qr_token_id)
       VALUES ($1, $2, $3, 'checkin', 'qr', $4)`,
      [seeds.acmeId, seeds.romaStoreId, seeds.employee1Id, qt.id],
    );
  });

  afterAll(async () => {
    await cleanAttendance();
  });

  it('returns events list for manager', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .get('/api/attendance')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.events)).toBe(true);
    expect(res.body.data.events.length).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.data.total).toBe('number');
  });

  it('returns 403 for employee role', async () => {
    const token = await login('employee1@acme-test.com');
    const res = await request
      .get('/api/attendance')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
