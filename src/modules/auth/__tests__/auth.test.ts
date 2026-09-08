import supertest from 'supertest';
import { testPool, clearTestData, seedTestData, closeTestDb } from '../../../__tests__/helpers/db';

// Import the app — we need to create a test app instance
// Since index.ts starts the server, we'll create a minimal test app
import express from 'express';
import cors from 'cors';
import authRoutes from '../auth.routes';
import { asyncHandler } from '../../../utils/asyncHandler';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message });
});

const request = supertest(app);

let seeds: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => {
  // Run schema on test DB first (assumes migration has been applied)
  seeds = await seedTestData();
});

beforeEach(async () => {
  // Clear login attempts between tests
  await testPool.query('DELETE FROM login_attempts');
  await testPool.query('DELETE FROM audit_logs');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

describe('POST /api/auth/login', () => {
  it('returns token and user on valid credentials', async () => {
    const res = await request.post('/api/auth/login').send({
      email: 'admin@acme-test.com',
      password: 'password123',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.role).toBe('admin');
    expect(res.body.data.user.email).toBe('admin@acme-test.com');
  });

  it('returns 401 for wrong password', async () => {
    const res = await request.post('/api/auth/login').send({
      email: 'admin@acme-test.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 for unknown email', async () => {
    const res = await request.post('/api/auth/login').send({
      email: 'nobody@acme-test.com',
      password: 'password123',
    });
    expect(res.status).toBe(401);
  });

  it('rate limits after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'wrong' });
    }
    const res = await request.post('/api/auth/login').send({
      email: 'admin@acme-test.com',
      password: 'password123', // correct password, but rate limited
    });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request.post('/api/auth/login').send({ email: 'notanemail', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/auth/me', () => {
  it('returns current user for valid token', async () => {
    const loginRes = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
    const token = loginRes.body.data.token;

    const res = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('admin@acme-test.com');
  });

  it('returns 401 without token', async () => {
    const res = await request.get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('logs out successfully', async () => {
    const loginRes = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
    const token = loginRes.body.data.token;

    const res = await request.post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PUT /api/auth/password', () => {
  it('changes password and returns new token', async () => {
    // Login as employee (so we don't mess up admin account)
    const loginRes = await request.post('/api/auth/login').send({ email: 'employee1@acme-test.com', password: 'password123' });
    const token = loginRes.body.data.token;

    // Tests send snake_case (matching what the Axios interceptor sends in the real frontend)
    const res = await request.put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'password123', new_password: 'newpassword456' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();

    // Reset password back
    const newToken = res.body.data.token;
    await request.put('/api/auth/password')
      .set('Authorization', `Bearer ${newToken}`)
      .send({ current_password: 'newpassword456', new_password: 'password123' });
  });

  it('returns 401 for wrong current password', async () => {
    const loginRes = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
    const token = loginRes.body.data.token;

    const res = await request.put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'wrongcurrent', new_password: 'newpassword456' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
  });
});
