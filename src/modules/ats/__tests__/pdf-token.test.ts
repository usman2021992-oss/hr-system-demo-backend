import { signCandidatePdfToken, verifyCandidatePdfToken } from '../ats.controller';
import { closeTestDb } from '../../../__tests__/helpers/db';
import { pool } from '../../../config/database';
import crypto from 'crypto';

describe('ATS PDF Tokens', () => {
  const candidateId = 123;
  const companyId = 456;
  const interviewId = 789;

  // Make sure we have an environment secret set
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-token-secret-xyz';
  });

  afterAll(async () => {
    // Cleanly close both connection pools so Jest exits immediately
    await pool.end();
    await closeTestDb();
  });

  describe('signCandidatePdfToken & verifyCandidatePdfToken (New format)', () => {
    it('signs and verifies interviewer token correctly', () => {
      const token = signCandidatePdfToken(candidateId, companyId, interviewId, 'interviewer');
      expect(token).toContain('interviewer');

      const verified = verifyCandidatePdfToken(token, candidateId);
      expect(verified).not.toBeNull();
      expect(verified!.companyId).toBe(companyId);
      expect(verified!.interviewId).toBe(interviewId);
      expect(verified!.recipientType).toBe('interviewer');
    });

    it('signs and verifies candidate token correctly', () => {
      const token = signCandidatePdfToken(candidateId, companyId, interviewId, 'candidate');
      expect(token).toContain('candidate');

      const verified = verifyCandidatePdfToken(token, candidateId);
      expect(verified).not.toBeNull();
      expect(verified!.companyId).toBe(companyId);
      expect(verified!.interviewId).toBe(interviewId);
      expect(verified!.recipientType).toBe('candidate');
    });

    it('fails verification if expected candidate ID does not match', () => {
      const token = signCandidatePdfToken(candidateId, companyId, interviewId, 'interviewer');
      const verified = verifyCandidatePdfToken(token, 999);
      expect(verified).toBeNull();
    });

    it('fails verification if token signature is tempered with', () => {
      const token = signCandidatePdfToken(candidateId, companyId, interviewId, 'interviewer');
      const modifiedToken = token.replace('interviewer', 'candidate');
      const verified = verifyCandidatePdfToken(modifiedToken, candidateId);
      expect(verified).toBeNull();
    });
  });

  describe('verifyCandidatePdfToken (Old format compatibility / safe fallback)', () => {
    // Helper to generate old format tokens (5 dot-separated parts: candidateId.companyId.interviewId.expiresAt.signature)
    function generateOldToken(candId: number, compId: number, intId: number): string {
      const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
      const payload = `${candId}.${compId}.${intId}.${expiresAt}`;
      const secret = process.env.JWT_SECRET ?? process.env.QR_SECRET ?? 'ats-pdf-token-secret';
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      return `${payload}.${signature}`;
    }

    it('successfully verifies old token format and defaults role to candidate (safe mode)', () => {
      const oldToken = generateOldToken(candidateId, companyId, interviewId);
      const parts = oldToken.split('.');
      expect(parts.length).toBe(5);

      const verified = verifyCandidatePdfToken(oldToken, candidateId);
      expect(verified).not.toBeNull();
      expect(verified!.companyId).toBe(companyId);
      expect(verified!.interviewId).toBe(interviewId);
      expect(verified!.recipientType).toBe('candidate'); // Defaults to candidate to hide comments!
    });

    it('fails old format token verification if signature does not match', () => {
      const oldToken = generateOldToken(candidateId, companyId, interviewId);
      // Alter the last character of the signature
      const lastChar = oldToken.slice(-1);
      const newChar = lastChar === 'a' ? 'b' : 'a';
      const tamperedToken = oldToken.slice(0, -1) + newChar;

      const verified = verifyCandidatePdfToken(tamperedToken, candidateId);
      expect(verified).toBeNull();
    });
  });
});
