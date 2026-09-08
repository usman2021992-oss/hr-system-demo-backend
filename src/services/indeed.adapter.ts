// ---------------------------------------------------------------------------
// Indeed Job Posting API adapter
// ---------------------------------------------------------------------------
// When INDEED_API_KEY is not set, a stub implementation is used that logs
// to console and returns fake IDs. When the key is present, the real
// implementation calls Indeed Job Posting API v3.
// ---------------------------------------------------------------------------

export interface IndeedJobPosting {
  title: string;
  description: string;
  companyName: string;
  location?: string;
}

export interface IndeedApplication {
  fullName: string;
  email: string;
  phone?: string;
  applyDate: string;
  sourceRef: string; // Indeed internal application ID
}

export interface IndeedAdapter {
  publishJob(posting: IndeedJobPosting): Promise<string>; // returns indeed_post_id
  getApplications(indeedPostId: string): Promise<IndeedApplication[]>;
  deleteJob(indeedPostId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stub adapter — used when INDEED_API_KEY is not configured
// ---------------------------------------------------------------------------

class StubIndeedAdapter implements IndeedAdapter {
  async publishJob(posting: IndeedJobPosting): Promise<string> {
    const fakeId = `indeed_stub_${Date.now()}`;
    console.log('[Indeed Stub] publishJob:', { posting, fakeId });
    return fakeId;
  }

  async getApplications(indeedPostId: string): Promise<IndeedApplication[]> {
    console.log('[Indeed Stub] getApplications:', indeedPostId);
    return [];
  }

  async deleteJob(indeedPostId: string): Promise<void> {
    console.log('[Indeed Stub] deleteJob:', indeedPostId);
  }
}

// ---------------------------------------------------------------------------
// Real adapter — calls Indeed Job Posting API v3
// ---------------------------------------------------------------------------

interface IndeedJobResponse {
  jobKey?: string;
  id?: string;
}

interface IndeedApplicationResponse {
  applicationId?: string;
  id?: string;
  applicant?: {
    fullName?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  applyDate?: string;
  appliedAt?: string;
}

interface IndeedApplicationsListResponse {
  applications?: IndeedApplicationResponse[];
  results?: IndeedApplicationResponse[];
}

class RealIndeedAdapter implements IndeedAdapter {
  private readonly apiKey: string;
  private readonly publisherId: string;
  private readonly baseUrl = 'https://apis.indeed.com/publisher/v3';

  constructor() {
    if (!process.env.INDEED_API_KEY) {
      throw new Error('INDEED_API_KEY environment variable is required for RealIndeedAdapter');
    }
    this.apiKey = process.env.INDEED_API_KEY;
    this.publisherId = process.env.INDEED_PUBLISHER_ID ?? '';
  }

  private get headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(this.publisherId ? { 'X-Publisher-Id': this.publisherId } : {}),
    };
  }

  async publishJob(posting: IndeedJobPosting): Promise<string> {
    const body = JSON.stringify({
      title: posting.title,
      description: posting.description,
      company: { name: posting.companyName },
      location: posting.location ? { address: posting.location } : undefined,
    });

    const response = await fetch(`${this.baseUrl}/jobs`, {
      method: 'POST',
      headers: this.headers,
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Indeed publishJob failed: HTTP ${response.status} ${response.statusText}. Body: ${text}`
      );
    }

    const data = (await response.json()) as IndeedJobResponse;
    const postId = data.jobKey ?? data.id;
    if (!postId) {
      throw new Error('Indeed publishJob: response did not include a job ID');
    }
    return postId;
  }

  async getApplications(indeedPostId: string): Promise<IndeedApplication[]> {
    const response = await fetch(`${this.baseUrl}/jobs/${indeedPostId}/applications`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Indeed getApplications failed: HTTP ${response.status} ${response.statusText}. Body: ${text}`
      );
    }

    const data = (await response.json()) as IndeedApplicationsListResponse;
    const raw = data.applications ?? data.results ?? [];

    return raw.map((a: IndeedApplicationResponse): IndeedApplication => ({
      fullName: a.applicant?.fullName ?? a.applicant?.name ?? 'Sconosciuto',
      email: a.applicant?.email ?? '',
      phone: a.applicant?.phone ?? undefined,
      applyDate: a.applyDate ?? a.appliedAt ?? new Date().toISOString(),
      sourceRef: a.applicationId ?? a.id ?? `indeed_${Date.now()}`,
    }));
  }

  async deleteJob(indeedPostId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/jobs/${indeedPostId}`, {
      method: 'DELETE',
      headers: this.headers,
    });

    // 404 is acceptable — job may already be removed on Indeed's side
    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Indeed deleteJob failed: HTTP ${response.status} ${response.statusText}. Body: ${text}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — returns the appropriate adapter based on env config
// ---------------------------------------------------------------------------

export function getIndeedAdapter(): IndeedAdapter {
  return process.env.INDEED_API_KEY ? new RealIndeedAdapter() : new StubIndeedAdapter();
}
