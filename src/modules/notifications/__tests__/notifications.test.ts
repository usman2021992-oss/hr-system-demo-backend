import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import notificationsRoutes from '../notifications.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';
import { sendNotification } from '../notifications.service';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
  },
);

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function login(email: string, password = 'password123'): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password });
  return res.body.data.token as string;
}

async function cleanNotifications(): Promise<void> {
  await testPool.query('DELETE FROM notification_failures');
  await testPool.query('DELETE FROM notification_settings');
  await testPool.query('DELETE FROM notifications');
}

/**
 * Directly inserts a notification into the DB for a given user, bypassing
 * the service layer so tests are self-contained.
 */
async function seedNotification(options: {
  companyId: number;
  userId: number;
  type?: string;
  title?: string;
  message?: string;
  priority?: string;
  isRead?: boolean;
}): Promise<number> {
  const { companyId, userId } = options;
  const type     = options.type     ?? 'manager.alert';
  const title    = options.title    ?? 'Test Notification';
  const message  = options.message  ?? 'This is a test notification';
  const priority = options.priority ?? 'medium';
  const isRead   = options.isRead   ?? false;

  const row = await testPool.query<{ id: number }>(
    `INSERT INTO notifications
       (company_id, user_id, type, title, message, priority, is_read)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [companyId, userId, type, title, message, priority, isRead],
  );
  return row.rows[0].id;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Ensure notification tables exist in the test DB
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      type       TEXT NOT NULL,
      title      TEXT NOT NULL,
      message    TEXT NOT NULL,
      priority   TEXT NOT NULL DEFAULT 'medium',
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_read    BOOLEAN NOT NULL DEFAULT FALSE,
      read_at    TIMESTAMPTZ,
      locale     TEXT NOT NULL DEFAULT 'it',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await testPool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await testPool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'it'`);
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS notification_settings (
      id         SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      event_key  TEXT NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      roles      TEXT[] NOT NULL DEFAULT ARRAY['admin','hr'],
      UNIQUE (company_id, event_key)
    );
  `);
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS notification_failures (
      id         SERIAL PRIMARY KEY,
      company_id INTEGER,
      user_id    INTEGER,
      event_key  TEXT,
      error      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS notification_templates (
      id         SERIAL PRIMARY KEY,
      event_key  TEXT NOT NULL UNIQUE,
      channel    TEXT NOT NULL,
      subject_it TEXT,
      body_it    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  seeds = await seedTestData();
  await testPool.query('DELETE FROM login_attempts');
  await testPool.query('DELETE FROM audit_logs');
});

afterAll(async () => {
  await cleanNotifications();
  await clearTestData();
  await closeTestDb();
});

afterEach(async () => {
  await cleanNotifications();
});

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

describe('GET /api/notifications', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request.get('/api/notifications');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('employee can list their own notifications', async () => {
    await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.employee1Id,
      title:     'Turno assegnato',
      message:   'Hai un nuovo turno il 2026-04-05',
    });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.notifications[0].userId).toBe(seeds.employee1Id);
    expect(res.body.data.notifications[0].title).toBe('Turno assegnato');
  });

  it('employee only sees their own notifications (not others)', async () => {
    // Seed a notification for the admin user
    await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.adminId,
      title:     'Admin Only',
    });
    // Seed a notification for employee1
    await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.employee1Id,
      title:     'Employee Only',
    });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.notifications[0].title).toBe('Employee Only');
  });

  it('pagination: limit and offset work correctly', async () => {
    // Seed 5 notifications for employee1
    for (let i = 1; i <= 5; i++) {
      await seedNotification({
        companyId: seeds.acmeId,
        userId:    seeds.employee1Id,
        title:     `Notification ${i}`,
      });
    }

    const token = await login('employee1@acme-test.com');

    // First page: limit 2
    const page1 = await request
      .get('/api/notifications?limit=2&offset=0')
      .set('Authorization', `Bearer ${token}`);

    expect(page1.status).toBe(200);
    expect(page1.body.data.notifications).toHaveLength(2);
    expect(page1.body.data.total).toBe(5);
    expect(page1.body.data.limit).toBe(2);

    // Second page: offset 2
    const page2 = await request
      .get('/api/notifications?limit=2&offset=2')
      .set('Authorization', `Bearer ${token}`);

    expect(page2.status).toBe(200);
    expect(page2.body.data.notifications).toHaveLength(2);

    // Third page: offset 4 — only 1 left
    const page3 = await request
      .get('/api/notifications?limit=2&offset=4')
      .set('Authorization', `Bearer ${token}`);

    expect(page3.status).toBe(200);
    expect(page3.body.data.notifications).toHaveLength(1);
  });

  it('unread_only filter returns only unread notifications', async () => {
    await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.employee1Id,
      title:     'Unread',
      isRead:    false,
    });
    await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.employee1Id,
      title:     'Already Read',
      isRead:    true,
    });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .get('/api/notifications?unread_only=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.notifications[0].title).toBe('Unread');
  });

  it('response includes unreadCount', async () => {
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: false });
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: true });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.unreadCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/notifications/:id/read
// ---------------------------------------------------------------------------

describe('PATCH /api/notifications/:id/read', () => {
  it('user can mark their own notification as read', async () => {
    const notifId = await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.employee1Id,
    });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .patch(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(notifId);
    expect(res.body.data.isRead).toBe(true);

    // Verify in DB
    const row = await testPool.query(
      'SELECT is_read FROM notifications WHERE id = $1',
      [notifId],
    );
    expect(row.rows[0].is_read).toBe(true);
  });

  it('user cannot mark another user\'s notification as read (403)', async () => {
    // Seed a notification belonging to admin
    const adminNotifId = await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.adminId,
    });

    // employee1 tries to mark the admin's notification as read
    const token = await login('employee1@acme-test.com');
    const res   = await request
      .patch(`/api/notifications/${adminNotifId}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 for non-existent notification', async () => {
    const token = await login('employee1@acme-test.com');
    const res   = await request
      .patch('/api/notifications/999999/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 for unauthenticated request', async () => {
    const notifId = await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.employee1Id,
    });

    const res = await request.patch(`/api/notifications/${notifId}/read`);
    expect(res.status).toBe(401);
  });

  it('marking an already-read notification is idempotent (200)', async () => {
    const notifId = await seedNotification({
      companyId: seeds.acmeId,
      userId:    seeds.employee1Id,
      isRead:    true,
    });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .patch(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.alreadyRead).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/notifications/read-all
// ---------------------------------------------------------------------------

describe('PATCH /api/notifications/read-all', () => {
  it('marks all unread notifications as read and returns count', async () => {
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: false });
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: false });
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: true });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(2); // only the 2 unread ones

    // Verify all notifications for this user are now read
    const rows = await testPool.query(
      'SELECT is_read FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [seeds.employee1Id],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('returns count 0 when there are no unread notifications', async () => {
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: true });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(0);
  });

  it('only marks notifications for the authenticated user', async () => {
    // Seed for both employee1 and admin
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: false });
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.adminId,     isRead: false });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1); // only employee1's notification

    // Admin's notification should still be unread
    const adminRow = await testPool.query(
      'SELECT is_read FROM notifications WHERE user_id = $1',
      [seeds.adminId],
    );
    expect(adminRow.rows[0].is_read).toBe(false);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request.patch('/api/notifications/read-all');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count
// ---------------------------------------------------------------------------

describe('GET /api/notifications/unread-count', () => {
  it('returns correct unread count', async () => {
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: false });
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: false });
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: true });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(2);
  });

  it('returns 0 when no unread notifications exist', async () => {
    const token = await login('employee1@acme-test.com');
    const res   = await request
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(0);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request.get('/api/notifications/unread-count');
    expect(res.status).toBe(401);
  });

  it('count is scoped to the authenticated user only', async () => {
    // Seed 3 notifications for admin, 1 for employee1
    for (let i = 0; i < 3; i++) {
      await seedNotification({ companyId: seeds.acmeId, userId: seeds.adminId, isRead: false });
    }
    await seedNotification({ companyId: seeds.acmeId, userId: seeds.employee1Id, isRead: false });

    const token = await login('employee1@acme-test.com');
    const res   = await request
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/notifications/settings
// ---------------------------------------------------------------------------

describe('GET /api/notifications/settings', () => {
  it('returns 403 for employee', async () => {
    const token = await login('employee1@acme-test.com');
    const res   = await request
      .get('/api/notifications/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for store_manager', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res   = await request
      .get('/api/notifications/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 and settings list for admin', async () => {
    // Seed a setting
    await testPool.query(
      `INSERT INTO notification_settings (company_id, event_key, enabled, roles)
       VALUES ($1, 'leave.submitted', true, ARRAY['admin','hr'])
       ON CONFLICT (company_id, event_key) DO NOTHING`,
      [seeds.acmeId],
    );

    const token = await login('admin@acme-test.com');
    const res   = await request
      .get('/api/notifications/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.settings)).toBe(true);
    expect(res.body.data.settings.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.settings[0]).toHaveProperty('eventKey');
    expect(res.body.data.settings[0]).toHaveProperty('enabled');
    expect(res.body.data.settings[0]).toHaveProperty('roles');
  });

  it('returns 200 and settings list for hr', async () => {
    const token = await login('hr@acme-test.com');
    const res   = await request
      .get('/api/notifications/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.settings)).toBe(true);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request.get('/api/notifications/settings');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/notifications/settings/:eventKey
// ---------------------------------------------------------------------------

describe('PATCH /api/notifications/settings/:eventKey', () => {
  it('admin can create a new notification setting', async () => {
    const token = await login('admin@acme-test.com');
    const res   = await request
      .patch('/api/notifications/settings/shift.assigned')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false, roles: ['admin'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.setting.eventKey).toBe('shift.assigned');
    expect(res.body.data.setting.enabled).toBe(false);
    expect(res.body.data.setting.roles).toEqual(['admin']);
  });

  it('admin can update an existing notification setting', async () => {
    // Pre-seed
    await testPool.query(
      `INSERT INTO notification_settings (company_id, event_key, enabled, roles)
       VALUES ($1, 'leave.approved', true, ARRAY['admin','hr'])
       ON CONFLICT (company_id, event_key) DO NOTHING`,
      [seeds.acmeId],
    );

    const token = await login('admin@acme-test.com');
    const res   = await request
      .patch('/api/notifications/settings/leave.approved')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.data.setting.enabled).toBe(false);

    // Verify in DB
    const row = await testPool.query(
      'SELECT enabled FROM notification_settings WHERE company_id = $1 AND event_key = $2',
      [seeds.acmeId, 'leave.approved'],
    );
    expect(row.rows[0].enabled).toBe(false);
  });

  it('employee gets 403', async () => {
    const token = await login('employee1@acme-test.com');
    const res   = await request
      .patch('/api/notifications/settings/shift.assigned')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('hr gets 403 (only admin can update settings)', async () => {
    const token = await login('hr@acme-test.com');
    const res   = await request
      .patch('/api/notifications/settings/shift.assigned')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when enabled is missing', async () => {
    const token = await login('admin@acme-test.com');
    const res   = await request
      .patch('/api/notifications/settings/shift.assigned')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const token = await login('admin@acme-test.com');
    const res   = await request
      .patch('/api/notifications/settings/shift.assigned')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when roles is not an array', async () => {
    const token = await login('admin@acme-test.com');
    const res   = await request
      .patch('/api/notifications/settings/shift.assigned')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true, roles: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request
      .patch('/api/notifications/settings/shift.assigned')
      .send({ enabled: true });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Module-permission gating (Issue #1)
// ---------------------------------------------------------------------------

describe('Notification module-permission gating', () => {
  async function countFor(userId: number, type: string): Promise<number> {
    const r = await testPool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND type = $2',
      [userId, type],
    );
    return parseInt(r.rows[0].count, 10);
  }

  it('does NOT dispatch attendance.anomaly to an employee (module not eligible)', async () => {
    await sendNotification({
      companyId: seeds.acmeId,
      userId: seeds.employee1Id,
      type: 'attendance.anomaly',
      title: 'Anomalia',
      message: 'Test anomaly',
    });

    expect(await countFor(seeds.employee1Id, 'attendance.anomaly')).toBe(0);
  });

  it('does dispatch shift.assigned to an employee when the turni module is enabled', async () => {
    await sendNotification({
      companyId: seeds.acmeId,
      userId: seeds.employee1Id,
      type: 'shift.assigned',
      title: 'Turno',
      message: 'Test shift',
    });

    expect(await countFor(seeds.employee1Id, 'shift.assigned')).toBe(1);
  });

  it('does NOT dispatch shift.assigned to an employee when the turni module is disabled', async () => {
    await testPool.query(
      `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
       VALUES ($1, 'employee', 'turni', false)
       ON CONFLICT (company_id, role, module_name) DO UPDATE SET is_enabled = false`,
      [seeds.acmeId],
    );

    await sendNotification({
      companyId: seeds.acmeId,
      userId: seeds.employee1Id,
      type: 'shift.assigned',
      title: 'Turno',
      message: 'Test shift',
    });

    expect(await countFor(seeds.employee1Id, 'shift.assigned')).toBe(0);

    // restore default
    await testPool.query(
      `UPDATE role_module_permissions SET is_enabled = true
       WHERE company_id = $1 AND role = 'employee' AND module_name = 'turni'`,
      [seeds.acmeId],
    );
  });

  it('hides already-stored anomaly notifications from the employee inbox', async () => {
    await seedNotification({
      companyId: seeds.acmeId,
      userId: seeds.employee1Id,
      type: 'attendance.anomaly',
      title: 'Old Anomaly',
    });
    await seedNotification({
      companyId: seeds.acmeId,
      userId: seeds.employee1Id,
      type: 'manager.alert',
      title: 'Stays Visible',
    });

    const token = await login('employee1@acme-test.com');
    const res = await request
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.notifications[0].title).toBe('Stays Visible');
  });
});
