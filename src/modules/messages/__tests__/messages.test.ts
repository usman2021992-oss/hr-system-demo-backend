import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import messagesRoutes from '../messages.routes';
import { seedTestData, clearTestData, closeTestDb } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/messages', messagesRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => { seeds = await seedTestData(); });
afterAll(async () => { await clearTestData(); await closeTestDb(); });

async function loginAs(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token;
}

describe('POST /api/messages', () => {
  it('hr can send a message to an employee', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: seeds.employee1Id, subject: 'Test Subject', body: 'Hello employee' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subject).toBe('Test Subject');
    expect(res.body.data.is_read).toBe(false);
  });

  it('admin can send a message to an employee', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: seeds.employee1Id, subject: 'Admin msg', body: 'From admin' });
    expect(res.status).toBe(201);
  });

  it('employee cannot send messages', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: seeds.adminId, subject: 'Hi', body: 'Hi boss' });
    expect(res.status).toBe(403);
  });

  it('rejects message to non-existent recipient', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: 99999, subject: 'Test', body: 'Test' });
    expect(res.status).toBe(404);
  });

  it('requires body', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: seeds.employee1Id, subject: '', body: '' });
    expect(res.status).toBe(400);
  });

  it('allows empty subject', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: seeds.employee1Id, body: 'Body without subject' });

    expect(res.status).toBe(201);
    expect(res.body.data.subject).toBe('');
  });
});

describe('GET /api/messages', () => {
  it('employee gets their received messages', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .get('/api/messages')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    res.body.data.forEach((m: any) => {
      expect(m.recipient_id).toBe(seeds.employee1Id);
    });
  });

  it('employee cannot see messages sent to another employee', async () => {
    const hrToken = await loginAs('hr@acme-test.com');
    await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ recipientId: seeds.adminId, subject: 'For admin', body: 'Only admin' });

    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .get('/api/messages')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const adminMessages = res.body.data.filter((m: any) => m.recipient_id === seeds.adminId);
    expect(adminMessages.length).toBe(0);
  });
});

describe('GET /api/messages/unread-count', () => {
  it('returns unread count for employee', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const res = await request
      .get('/api/messages/unread-count')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.unreadCount).toBe('number');
    expect(res.body.data.unreadCount).toBeGreaterThan(0);
  });
});

describe('PATCH /api/messages/:id/read', () => {
  it('recipient can mark message as read', async () => {
    const token = await loginAs('employee1@acme-test.com');
    const listRes = await request
      .get('/api/messages')
      .set('Authorization', `Bearer ${token}`);
    const msgId = listRes.body.data[0].id;

    const res = await request
      .patch(`/api/messages/${msgId}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_read).toBe(true);
  });

  it('non-recipient cannot mark message as read', async () => {
    const hrToken = await loginAs('hr@acme-test.com');
    const sendRes = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ recipientId: seeds.employee1Id, subject: 'S', body: 'B' });
    const msgId = sendRes.body.data.id;

    const res = await request
      .patch(`/api/messages/${msgId}/read`)
      .set('Authorization', `Bearer ${hrToken}`);
    expect(res.status).toBe(403);
  });
});
