import { query, queryOne } from '../../config/database';

export interface RiskFlags {
  lowCandidates: boolean;
  noInterviews: boolean;
  noHires: boolean;
}

export type RiskLevel = 'ok' | 'medium' | 'high';

export function calculateRiskLevel(flags: RiskFlags): RiskLevel {
  const count = [flags.lowCandidates, flags.noInterviews, flags.noHires].filter(Boolean).length;
  if (count === 0) return 'ok';
  if (count === 1) return 'medium';
  return 'high';
}

export interface JobRisk {
  jobPostingId: number;
  jobTitle: string;
  flags: RiskFlags;
  riskLevel: RiskLevel;
}

export async function evaluateJobRisk(jobPostingId: number, companyId: number): Promise<JobRisk | null> {
  const job = await queryOne<{
    id: number;
    title: string;
    published_at: string | null;
    status: string;
  }>(
    `SELECT id, title, published_at, status FROM job_postings WHERE id = $1 AND company_id = $2`,
    [jobPostingId, companyId],
  );
  if (!job || job.status !== 'published') return null;

  const publishedAt = job.published_at ? new Date(job.published_at) : new Date();
  const daysPublished = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);

  // Flag 1: Fewer than 3 received candidates in last 7 days
  const candRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM candidates
     WHERE job_posting_id = $1 AND company_id = $2 AND status = 'received' AND created_at >= NOW() - INTERVAL '7 days'`,
    [jobPostingId, companyId],
  );
  const lowCandidates = parseInt(candRow?.count ?? '0', 10) < 3;

  // Flag 2: Published >14 days with no interviews
  let noInterviews = false;
  if (daysPublished > 14) {
    const intRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM interviews i
       JOIN candidates c ON c.id = i.candidate_id
       WHERE c.job_posting_id = $1 AND c.company_id = $2`,
      [jobPostingId, companyId],
    );
    noInterviews = parseInt(intRow?.count ?? '0', 10) === 0;
  }

  // Flag 3: Published >30 days with no hires
  let noHires = false;
  if (daysPublished > 30) {
    const hireRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM candidates WHERE job_posting_id = $1 AND company_id = $2 AND status = 'hired'`,
      [jobPostingId, companyId],
    );
    noHires = parseInt(hireRow?.count ?? '0', 10) === 0;
  }

  const flags: RiskFlags = { lowCandidates, noInterviews, noHires };
  const riskLevel = calculateRiskLevel(flags);

  // Persist snapshot
  await query(
    `INSERT INTO job_risk_snapshots (job_posting_id, low_candidates, no_interviews, no_hires)
     VALUES ($1, $2, $3, $4)`,
    [jobPostingId, lowCandidates, noInterviews, noHires],
  );

  return { jobPostingId: job.id, jobTitle: job.title, flags, riskLevel };
}

export async function evaluateAllJobRisks(companyId: number): Promise<JobRisk[]> {
  const jobs = await query<{ id: number }>(
    `SELECT id FROM job_postings WHERE company_id = $1 AND status = 'published'`,
    [companyId],
  );

  const results = await Promise.all(jobs.map((j) => evaluateJobRisk(j.id, companyId)));
  return results.filter((r): r is JobRisk => r !== null);
}
