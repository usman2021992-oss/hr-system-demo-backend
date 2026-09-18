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

  it('revokes the refresh token, even once the access token has expired', async () => {
    const loginRes = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
    const refreshToken = loginRes.body.data.refresh_token;

    const res = await request.post('/api/auth/logout')
      .set('Authorization', 'Bearer expired.or.garbage')
      .send({ refresh_token: refreshToken });
    expect(res.status).toBe(200);

    const after = await request.post('/api/auth/refresh').send({ refresh_token: refreshToken });
    expect(after.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('login hands out a refresh token, stored only as a hash', async () => {
    const loginRes = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
    const refreshToken = loginRes.body.data.refresh_token as string;
    expect(typeof refreshToken).toBe('string');
    expect(refreshToken.length).toBeGreaterThan(40);

    const { rows } = await testPool.query(`SELECT token_hash FROM auth_refresh_tokens WHERE token_hash = $1`, [refreshToken]);
    expect(rows).toHaveLength(0);
  });

  it('trades a live refresh token for a new, working access token', async () => {
    const loginRes = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
    const refreshToken = loginRes.body.data.refresh_token;

    const res = await request.post('/api/auth/refresh').send({ refresh_token: refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.refresh_token).toBe(refreshToken);

    const me = await request.get('/api/auth/me').set('Authorization', `Bearer ${res.body.data.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('admin@acme-test.com');
  });

  it('rejects an unknown token', async () => {
    const res = await request.post('/api/auth/refresh').send({ refresh_token: 'not-a-real-token' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects a token past its idle expiry', async () => {
    const loginRes = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
    await testPool.query(`UPDATE auth_refresh_tokens SET expires_at = NOW() - INTERVAL '1 minute'`);
    const res = await request.post('/api/auth/refresh').send({ refresh_token: loginRes.body.data.refresh_token });
    expect(res.status).toBe(401);
  });

  it('refuses a deactivated user', async () => {
    const loginRes = await request.post('/api/auth/login').send({ email: 'employee1@acme-test.com', password: 'password123' });
    await testPool.query(`UPDATE users SET status = 'inactive' WHERE email = 'employee1@acme-test.com'`);
    try {
      const res = await request.post('/api/auth/refresh').send({ refresh_token: loginRes.body.data.refresh_token });
      expect(res.status).toBe(401);
    } finally {
      await testPool.query(`UPDATE users SET status = 'active' WHERE email = 'employee1@acme-test.com'`);
    }
  });

  it('remember me gives a longer-lived refresh token, but the access token stays standard', async () => {
    const short = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
    const long = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123', remember_me: true });
    const { rows } = await testPool.query<{ remember_me: boolean; idle_hours: number }>(
      `SELECT remember_me, EXTRACT(EPOCH FROM (expires_at - created_at)) / 3600 AS idle_hours
       FROM auth_refresh_tokens ORDER BY id DESC LIMIT 2`,
    );
    expect(rows[0].remember_me).toBe(true);
    expect(Number(rows[0].idle_hours)).toBeGreaterThan(24 * 7);
    expect(rows[1].remember_me).toBe(false);
    expect(Math.round(Number(rows[1].idle_hours))).toBe(24);

    const claims = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    const shortLife = claims(short.body.data.token).exp - claims(short.body.data.token).iat;
    const longLife = claims(long.body.data.token).exp - claims(long.body.data.token).iat;
    expect(longLife).toBe(shortLife);
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

  it('ends the other sessions but keeps the one making the change', async () => {
    const other = await request.post('/api/auth/login').send({ email: 'employee1@acme-test.com', password: 'password123' });
    const mine = await request.post('/api/auth/login').send({ email: 'employee1@acme-test.com', password: 'password123' });

    const res = await request.put('/api/auth/password')
      .set('Authorization', `Bearer ${mine.body.data.token}`)
      .send({ current_password: 'password123', new_password: 'newpassword456', refresh_token: mine.body.data.refresh_token });
    expect(res.status).toBe(200);

    expect((await request.post('/api/auth/refresh').send({ refresh_token: other.body.data.refresh_token })).status).toBe(401);
    expect((await request.post('/api/auth/refresh').send({ refresh_token: mine.body.data.refresh_token })).status).toBe(200);

    await request.put('/api/auth/password')
      .set('Authorization', `Bearer ${res.body.data.token}`)
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
