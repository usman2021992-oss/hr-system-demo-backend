import express from 'express';
import supertest from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import authRoutes from '../../auth/auth.routes';
import employeesRoutes from '../employees.routes';
import { seedTestData, clearTestData, closeTestDb } from '../../../__tests__/helpers/db';

// Use a writable temp directory; jest.setup.ts sets UPLOADS_DIR to the same path
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(os.tmpdir(), 'hr-test-uploads', 'avatars');

const app = express();
app.use(express.json());
app.use('/uploads', express.static(path.dirname(UPLOADS_DIR)));
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;

// Tiny 1x1 JPEG for upload tests
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAQMEAgMAAAAAAAAAAAAAAQIDBAUREiExQVH/2gAIAQEAAD8AkNVSuS9iqY0',
  'base64'
);

beforeAll(async () => {
  seeds = await seedTestData();
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

async function loginAs(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token;
}

describe('POST /api/employees/:id/avatar', () => {
  it('employee can upload their own avatar', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/avatar`)
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', TINY_JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.avatarUrl).toMatch(/\/uploads\/avatars\//);
  });

  it('hr can upload avatar for any employee in their company', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/avatar`)
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', TINY_JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
  });

  it('super admin can upload avatar for employees in allowed companies', async () => {
    const token = await loginAs('superadmin@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/avatar`)
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', TINY_JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
  });

  it('employee cannot upload avatar for another employee', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.adminId}/avatar`)
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', TINY_JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
  });

  it('rejects files larger than 2MB', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const bigBuffer = Buffer.alloc(3 * 1024 * 1024); // 3MB
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/avatar`)
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', bigBuffer, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('rejects non-image files', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .post(`/api/employees/${seeds.employee1Id}/avatar`)
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.from('hello'), { filename: 'file.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/employees/:id/avatar', () => {
  it('employee can delete their own avatar', async () => {
    // First upload an avatar
    const hrToken = await loginAs('hr@acme-test.com');
    await request
      .post(`/api/employees/${seeds.employee1Id}/avatar`)
      .set('Authorization', `Bearer ${hrToken}`)
      .attach('avatar', TINY_JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .delete(`/api/employees/${seeds.employee1Id}/avatar`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('employee cannot delete another employee avatar', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .delete(`/api/employees/${seeds.adminId}/avatar`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
