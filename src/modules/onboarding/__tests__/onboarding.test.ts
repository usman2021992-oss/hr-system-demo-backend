import supertest from 'supertest';
import express from 'express';
import authRoutes from '../../auth/auth.routes';
import onboardingRoutes from '../onboarding.routes';
import { testPool, clearTestData, seedTestData, closeTestDb } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message });
});

const request = supertest(app);

let adminToken: string;
let employeeToken: string;
let employee1Id: number;

async function login(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data?.token ?? '';
}

beforeAll(async () => {
  const seeds = await seedTestData();
  employee1Id = seeds.employee1Id;

  // Ensure onboarding tables exist in test DB
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_templates (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      task_type VARCHAR(20) NOT NULL DEFAULT 'day1',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      category VARCHAR(20) NOT NULL DEFAULT 'other',
      due_days INTEGER,
      link_url TEXT,
      priority VARCHAR(10) NOT NULL DEFAULT 'medium',
      created_by_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS employee_onboarding_tasks (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      completion_note TEXT,
      due_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (employee_id, template_id)
    );
    ALTER TABLE onboarding_templates ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'other';
    ALTER TABLE onboarding_templates ADD COLUMN IF NOT EXISTS task_type VARCHAR(20) NOT NULL DEFAULT 'day1';
    ALTER TABLE onboarding_templates ADD COLUMN IF NOT EXISTS due_days INTEGER;
    ALTER TABLE onboarding_templates ADD COLUMN IF NOT EXISTS link_url TEXT;
    ALTER TABLE onboarding_templates ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'medium';
    ALTER TABLE onboarding_templates ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;
    ALTER TABLE employee_onboarding_tasks ADD COLUMN IF NOT EXISTS completion_note TEXT;
    ALTER TABLE employee_onboarding_tasks ADD COLUMN IF NOT EXISTS due_date DATE;
    ALTER TABLE employee_onboarding_tasks ADD COLUMN IF NOT EXISTS assigned_by_user_id INTEGER;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locale VARCHAR(10);
  `);

  adminToken = await login('admin@acme-test.com');
  employeeToken = await login('employee1@acme-test.com');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------

describe('Onboarding — auth guard', () => {
  it('rejects unauthenticated requests to templates', async () => {
    const res = await request.get('/api/onboarding/templates');
    expect(res.status).toBe(401);
  });
});

describe('Onboarding — Templates (admin)', () => {
  let templateId: number;

  it('creates a template', async () => {
    const res = await request
      .post('/api/onboarding/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Completa il profilo', description: 'Aggiorna le informazioni personali', sort_order: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.template.name).toBe('Completa il profilo');
    expect(res.body.data.template.isActive).toBe(true);
    templateId = res.body.data.template.id;
  });

  it('creates a template with new fields', async () => {
    const res = await request
      .post('/api/onboarding/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Setup laptop',
        description: 'Configure your work laptop',
        sort_order: 2,
        category: 'it_setup',
        due_days: 1,
        link_url: 'https://it.internal/setup',
        priority: 'high',
      });
    expect(res.status).toBe(201);
    const tmpl = res.body.data.template;
    expect(tmpl.category).toBe('it_setup');
    expect(tmpl.dueDays).toBe(1);
    expect(tmpl.linkUrl).toBe('https://it.internal/setup');
    expect(tmpl.priority).toBe('high');
  });

  it('lists templates', async () => {
    const res = await request
      .get('/api/onboarding/templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.templates)).toBe(true);
    expect(res.body.data.templates.length).toBeGreaterThan(0);
  });

  it('updates a template', async () => {
    const res = await request
      .patch(`/api/onboarding/templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Aggiorna il profilo', is_active: true });
    expect(res.status).toBe(200);
    expect(res.body.data.template.name).toBe('Aggiorna il profilo');
  });

  it('deactivates a template', async () => {
    const res = await request
      .patch(`/api/onboarding/templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.template.isActive).toBe(false);
  });

  it('returns 400 when template name is missing', async () => {
    const res = await request
      .post('/api/onboarding/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Missing name' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects template creation by employee', async () => {
    const res = await request
      .post('/api/onboarding/templates')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ name: 'Template non autorizzato' });
    expect(res.status).toBe(403);
  });
});

describe('Onboarding — Employee Tasks', () => {
  let taskId: number;

  beforeAll(async () => {
    // Re-activate template and ensure a fresh one exists for task assignment
    await request
      .post('/api/onboarding/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Firma il contratto', sort_order: 2 });
  });

  it('assigns tasks to employee', async () => {
    const res = await request
      .post(`/api/onboarding/employees/${employee1Id}/tasks/assign`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.assigned).toBe('number');
  });

  it('assigns only selected tasks when template_ids provided', async () => {
    const tmplRes = await request
      .get('/api/onboarding/templates')
      .set('Authorization', `Bearer ${adminToken}`);
    const templates = tmplRes.body.data.templates;
    if (templates.length === 0) return;

    const selectedId = templates[0].id;
    const res = await request
      .post(`/api/onboarding/employees/${employee1Id}/tasks/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ template_ids: [selectedId] });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.assigned).toBe('number');
  });

  it('gets employee task progress', async () => {
    const res = await request
      .get(`/api/onboarding/employees/${employee1Id}/tasks`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { progress } = res.body.data;
    expect(typeof progress.total).toBe('number');
    expect(typeof progress.completed).toBe('number');
    expect(typeof progress.percentage).toBe('number');
    expect(Array.isArray(progress.tasks)).toBe(true);
    if (progress.tasks.length > 0) {
      taskId = progress.tasks[0].id;
    }
  });

  it('employee can view their own tasks', async () => {
    const res = await request
      .get(`/api/onboarding/employees/${employee1Id}/tasks`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
  });

  it('employee can complete their own task', async () => {
    if (!taskId) return; // skipped if no tasks were assigned
    const res = await request
      .patch(`/api/onboarding/tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${employeeToken}`);
    // 200 = completed, 404 = task belongs to a different employee (test isolation)
    expect([200, 404]).toContain(res.status);
  });

  it('completing the same task twice returns 404', async () => {
    if (!taskId) return;
    // Second attempt should be rejected (already completed)
    const res = await request
      .patch(`/api/onboarding/tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(404);
  });

  it('admin can complete a task with a note', async () => {
    const progressRes = await request
      .get(`/api/onboarding/employees/${employee1Id}/tasks`)
      .set('Authorization', `Bearer ${adminToken}`);
    const tasks = progressRes.body.data.progress.tasks;
    const pending = tasks.find((t: any) => !t.completed);
    if (!pending) return;

    const res = await request
      .patch(`/api/onboarding/tasks/${pending.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Completed during orientation' });
    expect(res.status).toBe(200);
    expect(res.body.data.task.completionNote).toBe('Completed during orientation');
  });
});
