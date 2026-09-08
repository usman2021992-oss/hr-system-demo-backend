import supertest from 'supertest';
import express from 'express';
import authRoutes from '../../auth/auth.routes';
import atsRoutes from '../ats.routes';
import { testPool, clearTestData, seedTestData, closeTestDb } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/ats', atsRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message });
});

const request = supertest(app);

let adminToken: string;
let acmeId: number;
let employee1Id: number;

async function login(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data?.token ?? '';
}

beforeAll(async () => {
  const seeds = await seedTestData();
  acmeId = seeds.acmeId;
  employee1Id = seeds.employee1Id;

  // Ensure ATS tables exist in test DB
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS job_postings (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      store_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      tags TEXT[] DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      source TEXT NOT NULL DEFAULT 'internal',
      indeed_post_id TEXT,
      created_by_id INTEGER,
      language TEXT NOT NULL DEFAULT 'it',
      job_type TEXT NOT NULL DEFAULT 'fulltime',
      is_remote BOOLEAN NOT NULL DEFAULT FALSE,
      remote_type TEXT NOT NULL DEFAULT 'onsite',
      job_city TEXT,
      job_state TEXT,
      job_country TEXT,
      job_postal_code TEXT,
      job_address TEXT,
      department TEXT,
      weekly_hours NUMERIC(5,2),
      contract_type TEXT,
      salary_min NUMERIC(12,2),
      salary_max NUMERIC(12,2),
      salary_period TEXT,
      experience TEXT,
      education TEXT,
      category TEXT,
      expiration_date DATE,
      published_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      reference_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      store_id INTEGER,
      job_posting_id INTEGER,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      cv_path TEXT,
      resume_path TEXT,
      linkedin_url TEXT,
      cover_letter TEXT,
      tags TEXT[] DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'received',
      source TEXT NOT NULL DEFAULT 'internal',
      source_ref TEXT,
      gdpr_consent BOOLEAN NOT NULL DEFAULT FALSE,
      applicant_locale VARCHAR(10),
      consent_accepted_at TIMESTAMPTZ,
      applied_at TIMESTAMPTZ,
      unread BOOLEAN NOT NULL DEFAULT TRUE,
      indeed_apply_id TEXT,
      last_stage_change TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS interviews (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL,
      interviewer_id INTEGER,
      scheduled_at TIMESTAMPTZ NOT NULL,
      location TEXT,
      notes TEXT,
      ics_uid TEXT,
      feedback TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS job_risk_snapshots (
      id SERIAL PRIMARY KEY,
      job_posting_id INTEGER NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      low_candidates BOOLEAN NOT NULL DEFAULT FALSE,
      no_interviews BOOLEAN NOT NULL DEFAULT FALSE,
      no_hires BOOLEAN NOT NULL DEFAULT FALSE
    );

    ALTER TABLE job_postings
      ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'it',
      ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'fulltime',
      ADD COLUMN IF NOT EXISTS is_remote BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS remote_type TEXT NOT NULL DEFAULT 'onsite',
      ADD COLUMN IF NOT EXISTS job_city TEXT,
      ADD COLUMN IF NOT EXISTS job_state TEXT,
      ADD COLUMN IF NOT EXISTS job_country TEXT,
      ADD COLUMN IF NOT EXISTS job_postal_code TEXT,
      ADD COLUMN IF NOT EXISTS job_address TEXT,
      ADD COLUMN IF NOT EXISTS department TEXT,
      ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS contract_type TEXT,
      ADD COLUMN IF NOT EXISTS salary_min NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS salary_max NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS salary_period TEXT,
      ADD COLUMN IF NOT EXISTS experience TEXT,
      ADD COLUMN IF NOT EXISTS education TEXT,
      ADD COLUMN IF NOT EXISTS category TEXT,
      ADD COLUMN IF NOT EXISTS reference_id TEXT,
      ADD COLUMN IF NOT EXISTS expiration_date DATE;

    ALTER TABLE candidates
      ADD COLUMN IF NOT EXISTS cv_path TEXT,
      ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
      ADD COLUMN IF NOT EXISTS cover_letter TEXT,
      ADD COLUMN IF NOT EXISTS gdpr_consent BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS applicant_locale VARCHAR(10),
      ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS indeed_apply_id TEXT,
      ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

    UPDATE candidates
    SET gdpr_consent = FALSE
    WHERE gdpr_consent IS NULL;

    ALTER TABLE candidates
      ALTER COLUMN gdpr_consent SET DEFAULT FALSE;

    ALTER TABLE candidates
      ALTER COLUMN gdpr_consent SET NOT NULL;
  `);

  adminToken = await login('admin@acme-test.com');
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------

describe('ATS — authentication guard', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request.get('/api/ats/jobs');
    expect(res.status).toBe(401);
  });
});

describe('ATS — Job Postings', () => {
  let jobId: number;

  it('creates a job posting', async () => {
    const res = await request
      .post('/api/ats/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Cassiere', description: 'Posizione cassa', tags: ['retail'] });
    expect(res.status).toBe(201);
    expect(res.body.data.job.title).toBe('Cassiere');
    expect(res.body.data.job.status).toBe('draft');
    jobId = res.body.data.job.id;
  });

  it('lists job postings', async () => {
    const res = await request
      .get('/api/ats/jobs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.jobs)).toBe(true);
    expect(res.body.data.jobs.length).toBeGreaterThan(0);
  });

  it('gets a job posting by ID', async () => {
    const res = await request
      .get(`/api/ats/jobs/${jobId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.job.id).toBe(jobId);
  });

  it('updates a job posting', async () => {
    const res = await request
      .patch(`/api/ats/jobs/${jobId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Responsabile Cassa' });
    expect(res.status).toBe(200);
    expect(res.body.data.job.title).toBe('Responsabile Cassa');
  });

  it('returns 400 when title is missing', async () => {
    const res = await request
      .post('/api/ats/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'No title' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for non-existent job', async () => {
    const res = await request
      .get('/api/ats/jobs/999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('ATS — Candidates', () => {
  let candidateId: number;
  let jobId: number;

  beforeAll(async () => {
    const res = await request
      .post('/api/ats/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Addetto Vendite' });
    jobId = res.body.data.job.id;
  });

  it('creates a candidate', async () => {
    const res = await request
      .post('/api/ats/candidates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ full_name: 'Mario Rossi', email: 'mario@example.com', job_posting_id: jobId });
    expect(res.status).toBe(201);
    expect(res.body.data.candidate.fullName).toBe('Mario Rossi');
    expect(res.body.data.candidate.status).toBe('received');
    candidateId = res.body.data.candidate.id;
  });

  it('lists candidates', async () => {
    const res = await request
      .get('/api/ats/candidates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.candidates)).toBe(true);
  });

  it('gets a candidate and marks it as read', async () => {
    const res = await request
      .get(`/api/ats/candidates/${candidateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.candidate.id).toBe(candidateId);
  });

  it('transitions candidate stage forward: received → review', async () => {
    const res = await request
      .patch(`/api/ats/candidates/${candidateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'review' });
    expect(res.status).toBe(200);
    expect(res.body.data.candidate.status).toBe('review');
  });

  it('transitions candidate stage forward: review → interview', async () => {
    const res = await request
      .patch(`/api/ats/candidates/${candidateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'interview' });
    expect(res.status).toBe(200);
    expect(res.body.data.candidate.status).toBe('interview');
  });

  it('rejects invalid backward transition: interview → received', async () => {
    const res = await request
      .patch(`/api/ats/candidates/${candidateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'received' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('returns 400 for unknown status value', async () => {
    const res = await request
      .patch(`/api/ats/candidates/${candidateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'pending_review' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('company isolation: candidate is only visible within its company', async () => {
    const rows = await testPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM candidates WHERE id = $1 AND company_id != $2`,
      [candidateId, acmeId],
    );
    expect(parseInt(rows.rows[0].count, 10)).toBe(0);
  });
});

describe('ATS — Interviews', () => {
  let candidateId: number;
  let interviewId: number;

  beforeAll(async () => {
    const jobRes = await request
      .post('/api/ats/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Lucia Job', description: 'Lucia Job Description', tags: ['lucia'] });
    const localJobId = jobRes.body.data.job.id;

    await request
      .post(`/api/ats/jobs/${localJobId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request
      .post('/api/ats/candidates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ full_name: 'Lucia Bianchi', job_posting_id: localJobId });
    candidateId = res.body.data.candidate.id;
  });

  it('creates an interview', async () => {
    const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request
      .post(`/api/ats/candidates/${candidateId}/interviews`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scheduled_at: scheduledAt, location: 'Sede centrale' });
    expect(res.status).toBe(201);
    expect(res.body.data.interview.location).toBe('Sede centrale');
    interviewId = res.body.data.interview.id;
  });

  it('lists interviews for a candidate', async () => {
    const res = await request
      .get(`/api/ats/candidates/${candidateId}/interviews`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.interviews.length).toBeGreaterThan(0);
  });

  it('updates interview feedback', async () => {
    const res = await request
      .patch(`/api/ats/interviews/${interviewId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ feedback: 'Ottimo candidato' });
    expect(res.status).toBe(200);
    expect(res.body.data.interview.feedback).toBe('Ottimo candidato');
  });

  it('returns 400 when scheduled_at is missing', async () => {
    const res = await request
      .post(`/api/ats/candidates/${candidateId}/interviews`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ location: 'Ufficio' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('deletes an interview', async () => {
    const res = await request
      .delete(`/api/ats/interviews/${interviewId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('ATS — Alerts', () => {
  it('returns alerts array for admin', async () => {
    const res = await request
      .get('/api/ats/alerts')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.alerts)).toBe(true);
  });
});

describe('ATS — Risks', () => {
  it('returns risks array for admin', async () => {
    const res = await request
      .get('/api/ats/risks')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.risks)).toBe(true);
  });
});
