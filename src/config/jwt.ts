import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
const QR_SECRET = process.env.QR_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET environment variable is required');
if (!QR_SECRET) throw new Error('FATAL: QR_SECRET environment variable is required');
const QR_TOKEN_TTL = parseInt(process.env.QR_TOKEN_TTL || '180', 10);

export type UserRole = 'admin' | 'hr' | 'area_manager' | 'store_manager' | 'employee' | 'store_terminal' | 'system_admin';

export interface JwtPayload {
  userId: number;
  email: string;
  role: UserRole;
  companyId: number | null;
  storeId: number | null;
  supervisorId: number | null;
  is_super_admin: boolean;
  jti: string;
}

export interface QrPayload {
  companyId: number;
  shiftId: number;
  iat: number;
  exp: number;
}

export function signAuthToken(payload: Omit<JwtPayload, 'jti'>, rememberMe = false): string {
  const jti = crypto.randomUUID();
  const expiresIn = rememberMe ? '24h' : (process.env.JWT_EXPIRES_IN || '8h');
  return jwt.sign({ ...payload, jti }, JWT_SECRET!, { expiresIn: expiresIn as any });
}

export function verifyAuthToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET!) as JwtPayload;
}

export function signQrToken(companyId: number, shiftId: number): string {
  const nonce = crypto.randomBytes(8).toString('hex');
  return jwt.sign({ companyId, shiftId, nonce }, QR_SECRET!, { expiresIn: QR_TOKEN_TTL });
}

export function verifyQrToken(token: string): QrPayload {
  return jwt.verify(token, QR_SECRET!) as QrPayload;
}

// ---------------------------------------------------------------------------
// Phase 2: store-level QR tokens (companyId + storeId + nonce)
// ---------------------------------------------------------------------------

export interface QrTokenPayload {
  companyId: number;
  storeId: number;
  nonce: string;
  iat: number;
  exp: number;
}

export function signQrToken2(companyId: number, storeId: number, nonce: string): string {
  return jwt.sign({ companyId, storeId, nonce }, QR_SECRET!, { expiresIn: QR_TOKEN_TTL });
}

export function verifyQrToken2(token: string): QrTokenPayload {
  return jwt.verify(token, QR_SECRET!) as QrTokenPayload;
}
