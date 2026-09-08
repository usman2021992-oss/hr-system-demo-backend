import express from 'express';
import supertest from 'supertest';
import crypto from 'crypto';
import router from '../publicCareers.routes';
import { query, queryOne } from '../../../config/database';
import { createCandidate } from '../../ats/ats.service';
import { sendNotification } from '../../notifications/notifications.service';

// Mock database config
jest.mock('../../../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

// Mock ATS service
jest.mock('../../ats/ats.service', () => ({
  createCandidate: jest.fn(),
}));

// Mock notifications service
jest.mock('../../notifications/notifications.service', () => ({
  sendNotification: jest.fn(),
}));

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;
const mockCreateCandidate = createCandidate as jest.Mock;
const mockSendNotification = sendNotification as jest.Mock;

describe('Indeed Apply Integration webhook', () => {
  let app: any;
  let request: any;
  const secret = 'mock_veylohr_indeed_secret_2026';

  beforeAll(() => {
    process.env.INDEED_APPLY_SECRET = secret;
    app = express();
    app.use('/api/public', router);
    request = supertest(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock behavior for successful flow
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes('FROM job_postings')) {
        return Promise.resolve({
          id: 123,
          company_id: 1,
          store_id: 2,
          status: 'published',
          title: 'Test Job',
          company_name: 'Fusaro Uomo',
        });
      }
      if (sql.includes('FROM companies')) {
        return Promise.resolve({
          id: 1,
          slug: 'fusaro-uomo',
          name: 'Fusaro Uomo',
        });
      }
      return Promise.resolve(null);
    });

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM users')) {
        return Promise.resolve([
          { id: 10, locale: 'it' },
          { id: 11, locale: 'en' },
        ]);
      }
      return Promise.resolve([]);
    });

    mockCreateCandidate.mockResolvedValue({
      id: 999,
      fullName: 'John Doe',
    });

    mockSendNotification.mockResolvedValue(undefined);
  });

  const validPayload = {
    applicant: {
      fullName: 'John Doe',
      email: 'john.doe@example.com',
      phoneNumber: '+393331234567',
      resume: {
        file: {
          data: 'c29tZSBwZGYgZGF0YQ==', // "some pdf data" in base64
          fileName: 'cv.pdf',
        },
      },
    },
    job: {
      jobId: '123',
    },
    screenerQuestionsAndAnswers: [],
  };

  it('Test 1: Valid HMAC signature + valid payload → HTTP 200 + candidate created with source=indeed', async () => {
    const payloadString = JSON.stringify(validPayload);
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(payloadString);
    const validSignature = hmac.digest('base64');

    const res = await request
      .post('/api/public/indeed-apply/fusaro-uomo')
      .set('X-Indeed-Signature', validSignature)
      .set('Content-Type', 'application/json')
      .send(payloadString);

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');

    // Wait for the async setImmediate processing to run
    await new Promise((resolve) => setImmediate(resolve));

    // Verify candidate creation parameters
    expect(mockCreateCandidate).toHaveBeenCalledTimes(1);
    expect(mockCreateCandidate).toHaveBeenCalledWith(1, expect.objectContaining({
      fullName: 'John Doe',
      email: 'john.doe@example.com',
      phone: '+393331234567',
      jobPostingId: 123,
      storeId: 2,
      source: 'indeed',
      gdprConsent: true,
    }));

    // Verify notifications were sent to recruiters
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSendNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({
      companyId: 1,
      userId: 10,
      type: 'ats.candidate_received',
      locale: 'it',
    }));
    expect(mockSendNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({
      companyId: 1,
      userId: 11,
      type: 'ats.candidate_received',
      locale: 'en',
    }));
  });

  it('Test 2: Invalid HMAC signature → HTTP 200 (still) but candidate NOT created', async () => {
    const payloadString = JSON.stringify(validPayload);
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request
      .post('/api/public/indeed-apply/fusaro-uomo')
      .set('X-Indeed-Signature', 'badsignature123')
      .set('Content-Type', 'application/json')
      .send(payloadString);

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');

    await new Promise((resolve) => setImmediate(resolve));

    // Verify candidate was NOT created and warning was logged
    expect(mockCreateCandidate).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid HMAC signature'));

    consoleWarnSpy.mockRestore();
  });

  it('Test 3: Missing X-Indeed-Signature header → HTTP 200 but candidate not created', async () => {
    const payloadString = JSON.stringify(validPayload);
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request
      .post('/api/public/indeed-apply/fusaro-uomo')
      .set('Content-Type', 'application/json')
      .send(payloadString);

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');

    await new Promise((resolve) => setImmediate(resolve));

    // Verify candidate was NOT created and warning was logged
    expect(mockCreateCandidate).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid HMAC signature'));

    consoleWarnSpy.mockRestore();
  });

  it('Test 4: Valid signature + malformed JSON → HTTP 200, error caught and logged, no crash', async () => {
    const malformedBody = '{ "applicant": { "fullName": "John Doe" '; // missing brackets
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(malformedBody);
    const validSignature = hmac.digest('base64');

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request
      .post('/api/public/indeed-apply/fusaro-uomo')
      .set('X-Indeed-Signature', validSignature)
      .set('Content-Type', 'application/json')
      .send(malformedBody);

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');

    await new Promise((resolve) => setImmediate(resolve));

    // Verify error was logged and candidate creation was skipped
    expect(mockCreateCandidate).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('malformed JSON payload'), expect.any(String));

    consoleErrorSpy.mockRestore();
  });
});
