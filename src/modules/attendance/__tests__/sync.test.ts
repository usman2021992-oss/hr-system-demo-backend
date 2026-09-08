import express from 'express';
import supertest from 'supertest';
import attendanceRoutes from '../attendance.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';
import authRoutes from '../../auth/auth.routes';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;

async function login(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token as string;
}

beforeAll(async () => { seeds = await seedTestData(); });
afterAll(async () => { await clearTestData(); await closeTestDb(); });
afterEach(async () => {
  await testPool.query(`DELETE FROM attendance_events WHERE source = 'sync'`);
});

describe('POST /api/attendance/sync', () => {
  it('syncs a batch of offline events (store_terminal)', async () => {
    const token = await login('terminal@acme-test.com');
    const events = [
      { event_type: 'checkin',  user_id: seeds.employee1Id, event_time: new Date(Date.now() - 3600000).toISOString() },
      { event_type: 'checkout', user_id: seeds.employee1Id, event_time: new Date(Date.now() - 1800000).toISOString() },
    ];

    const res = await request
      .post('/api/attendance/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ events });

    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.data.failed).toBe('number');
  });

  it('returns 403 for unauthorized role', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .post('/api/attendance/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ event_type: 'checkin', user_id: seeds.employee1Id, event_time: new Date().toISOString() }] });

    expect(res.status).toBe(403);
  });

  it('skips invalid user IDs and reports them', async () => {
    const token = await login('terminal@acme-test.com');
    const events = [
      { event_type: 'checkin', user_id: 999999, event_time: new Date().toISOString() },
      { event_type: 'checkout', user_id: seeds.employee1Id, event_time: new Date().toISOString() },
    ];

    const res = await request
      .post('/api/attendance/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ events });

    expect(res.status).toBe(200);
    expect(res.body.data.failed).toBeGreaterThanOrEqual(1);
    expect(res.body.data.errors.length).toBeGreaterThan(0);
  });
});
