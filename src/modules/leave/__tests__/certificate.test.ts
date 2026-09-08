import express from 'express';
import supertest from 'supertest';
import leaveRoutes from '../leave.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';
import authRoutes from '../../auth/auth.routes';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/leave', leaveRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;
let createdLeaveId: number;

async function login(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token as string;
}

beforeAll(async () => { seeds = await seedTestData(); });
afterAll(async () => {
  if (createdLeaveId) {
    await testPool.query(`DELETE FROM leave_requests WHERE id = $1`, [createdLeaveId]);
  }
  await clearTestData();
  await closeTestDb();
});

describe('POST /api/leave — sick leave with certificate', () => {
  it('accepts sick leave with a PDF certificate attached', async () => {
    const token = await login('employee1@acme-test.com');
    const fakeFile = Buffer.from('%PDF-1.4 test certificate content');

    const res = await request
      .post('/api/leave')
      .set('Authorization', `Bearer ${token}`)
      .field('leave_type', 'sick')
      .field('start_date', '2026-04-10')
      .field('end_date', '2026-04-12')
      .field('notes', 'Test malattia')
      .attach('certificate', fakeFile, { filename: 'certificato.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.medical_certificate_name).toBe('certificato.pdf');
    createdLeaveId = res.body.data.id;
  });

  it('accepts sick leave without certificate (field is optional)', async () => {
    const token = await login('employee1@acme-test.com');
    const res = await request
      .post('/api/leave')
      .set('Authorization', `Bearer ${token}`)
      .send({ leave_type: 'sick', start_date: '2026-04-15', end_date: '2026-04-15' });

    expect(res.status).toBe(201);
    if (res.body.data?.id) {
      await testPool.query(`DELETE FROM leave_requests WHERE id = $1`, [res.body.data.id]);
    }
  });
});

describe('GET /api/leave/:id/certificate', () => {
  it('allows hr to download the certificate', async () => {
    if (!createdLeaveId) return;
    const token = await login('hr@acme-test.com');
    const res = await request
      .get(`/api/leave/${createdLeaveId}/certificate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
  });

  it('returns 404 when no certificate is attached', async () => {
    // Create a leave with no file
    const empToken = await login('employee1@acme-test.com');
    const createRes = await request
      .post('/api/leave')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ leave_type: 'sick', start_date: '2026-05-01', end_date: '2026-05-01' });
    const noCertId = createRes.body.data?.id;

    const hrToken = await login('hr@acme-test.com');
    const res = await request
      .get(`/api/leave/${noCertId}/certificate`)
      .set('Authorization', `Bearer ${hrToken}`);

    expect(res.status).toBe(404);
    if (noCertId) await testPool.query(`DELETE FROM leave_requests WHERE id = $1`, [noCertId]);
  });
});
