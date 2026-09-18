import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../../config/database';
import { signAuthToken, JwtPayload, UserRole } from '../../config/jwt';
import { ok, badRequest, unauthorized, serverError, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  issueRefreshToken,
  findLiveRefreshToken,
  touchRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from './refreshTokens';

interface UserRow {
  id: number;
  company_id: number | null;
  name: string;
  surname: string | null;
  email: string;
  password_hash: string;
  role: UserRole;
  store_id: number | null;
  supervisor_id: number | null;
  status: string;
  is_super_admin: boolean;
  avatar_filename: string | null;
  registered_device_token: string | null;
  registered_device_identifier: string | null;
  device_reset_pending: boolean;
}

async function isRateLimited(email: string, ip: string): Promise<boolean> {
  // Check both email-based (>=5 attempts) and IP-based (>=10 attempts) limits within 15 minutes
  const rows = await query<{ email_count: string; ip_count: string }>(
    `SELECT
       (SELECT COUNT(*) FROM login_attempts
        WHERE email = $1 AND attempted_at > NOW() - INTERVAL '15 minutes') AS email_count,
       (SELECT COUNT(*) FROM login_attempts
        WHERE ip_address = $2 AND attempted_at > NOW() - INTERVAL '15 minutes') AS ip_count`,
    [email, ip]
  );
  const emailCount = parseInt(rows[0].email_count, 10);
  const ipCount = parseInt(rows[0].ip_count, 10);

  // Best-effort cleanup of attempts older than 24 hours (M14) — never fails the request
  query(`DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours'`, []).catch(() => {});

  return emailCount >= 5 || ipCount >= 10;
}

type CompanyAccessBlock = { code: 'COMPANY_ACCESS_NOT_ACTIVE' | 'COMPANY_ACCESS_EXPIRED'; message: string };

/** The company's access window, as enforced at login. Shared by /login and /refresh. */
async function checkCompanyAccessWindow(
  user: Pick<UserRow, 'is_super_admin' | 'company_id'>,
): Promise<CompanyAccessBlock | null> {
  if (user.is_super_admin === true || user.company_id === null) return null;
  const comp = await queryOne<{ access_valid_from: string | null; access_valid_to: string | null }>(
    `SELECT access_valid_from, access_valid_to FROM companies WHERE id = $1`,
    [user.company_id]
  );
  if (!comp) return null;
  const now = new Date();
  if (comp.access_valid_from && now < new Date(comp.access_valid_from)) {
    return { code: 'COMPANY_ACCESS_NOT_ACTIVE', message: 'Accesso non ancora attivo per questa azienda.' };
  }
  if (comp.access_valid_to) {
    const toDate = new Date(comp.access_valid_to);
    toDate.setHours(23, 59, 59, 999);
    if (now > toDate) {
      return { code: 'COMPANY_ACCESS_EXPIRED', message: 'Il periodo di accesso per questa azienda è scaduto.' };
    }
  }
  return null;
}

type TokenUser = Pick<UserRow, 'id' | 'email' | 'role' | 'company_id' | 'store_id' | 'supervisor_id' | 'is_super_admin'>;

function signTokenForUser(user: TokenUser): string {
  // The access token keeps its normal lifetime whatever "remember me" says;
  // remembering the login is the refresh token's job.
  return signAuthToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    companyId: user.company_id,
    storeId: user.store_id,
    supervisorId: user.supervisor_id,
    is_super_admin: user.is_super_admin,
  });
}

function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
}

async function recordLoginAttempt(email: string, ip: string): Promise<void> {
  await query(
    `INSERT INTO login_attempts (email, ip_address) VALUES ($1, $2)`,
    [email, ip]
  );
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, remember_me, rememberMe } = req.body as { email: string; password: string; remember_me?: boolean; rememberMe?: boolean };
  const isRememberMe = remember_me ?? rememberMe;
  const ip = clientIp(req);

  // Rate limiting check
  if (await isRateLimited(email, ip)) {
    res.status(429).json({
      success: false,
      error: 'Troppi tentativi di accesso. Riprova tra 15 minuti.',
      code: 'RATE_LIMITED',
    });
    return;
  }

  const user = await queryOne<UserRow>(
    `SELECT id, company_id, name, surname, email, password_hash, role, store_id, supervisor_id, status, is_super_admin, avatar_filename,
            registered_device_token, registered_device_identifier, device_reset_pending
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    await recordLoginAttempt(email, ip);
    unauthorized(res, 'Email o password non validi', 'INVALID_CREDENTIALS');
    return;
  }

  if (user.status === 'inactive') {
    // Record attempt so inactive accounts can't be brute-forced
    await recordLoginAttempt(email, ip);
    forbidden(res, 'Account disattivato. Contatta l\'amministratore.', 'ACCOUNT_INACTIVE');
    return;
  }

  // Check company access validity for non-super-admins
  const companyBlock = await checkCompanyAccessWindow(user);
  if (companyBlock) {
    await recordLoginAttempt(email, ip);
    forbidden(res, companyBlock.message, companyBlock.code);
    return;
  }

  // Log successful login to audit_logs
  await query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, ip_address)
     VALUES ($1, $2, 'LOGIN', 'user', $3, $4)`,
    [user.company_id ?? null, user.id, user.id, ip]
  );

  // Clean up this user's login attempt history on successful login (M14)
  await query(`DELETE FROM login_attempts WHERE email = $1`, [email]);

  const token = signTokenForUser(user);
  const refreshToken = await issueRefreshToken(user.id, isRememberMe === true, {
    userAgent: req.headers['user-agent'] ?? null,
    ip,
  });

  ok(res, {
    token,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      name: user.name,
      surname: user.surname,
      email: user.email,
      role: user.role,
      status: user.status,
      companyId: user.company_id,
      storeId: user.store_id,
      supervisorId: user.supervisor_id,
      isSuperAdmin: user.is_super_admin,
      avatarFilename: user.avatar_filename,
      isDeviceRegistered: user.registered_device_token != null || user.registered_device_identifier != null,
      deviceResetPending: user.device_reset_pending === true,
      requiresDeviceRegistration:
        user.role !== 'admin' &&
        ((user.registered_device_token == null && user.registered_device_identifier == null) || user.device_reset_pending === true),
    },
  });
});

/**
 * POST /api/auth/refresh  { refresh_token }
 * Trades a live refresh token for a new access token, rebuilt from the current
 * user row (so a role or store change made meanwhile is picked up). No access
 * token required: the one it replaces is usually already expired.
 */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refresh_token } = req.body as { refresh_token: string };
  const row = await findLiveRefreshToken(refresh_token);
  if (!row) {
    unauthorized(res, 'Sessione scaduta. Effettua di nuovo l\'accesso.', 'INVALID_REFRESH_TOKEN');
    return;
  }

  const user = await queryOne<UserRow>(
    `SELECT id, company_id, name, surname, email, role, store_id, supervisor_id, status, is_super_admin
     FROM users WHERE id = $1`,
    [row.user_id]
  );
  if (!user || user.status === 'inactive') {
    await revokeRefreshToken(refresh_token);
    unauthorized(res, 'Sessione scaduta. Effettua di nuovo l\'accesso.', 'INVALID_REFRESH_TOKEN');
    return;
  }

  const companyBlock = await checkCompanyAccessWindow(user);
  if (companyBlock) {
    forbidden(res, companyBlock.message, companyBlock.code);
    return;
  }

  await touchRefreshToken(row);
  ok(res, { token: signTokenForUser(user), refresh_token });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // The access token is stateless and simply discarded by the client; the
  // refresh token is revoked here so it cannot mint new sessions.
  const { refresh_token } = (req.body ?? {}) as { refresh_token?: unknown };
  if (typeof refresh_token === 'string') await revokeRefreshToken(refresh_token);

  // Log logout event for audit trail.
  if (req.user) {
    const ip = clientIp(req);
    await query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, $2, 'LOGOUT', 'user', $3, $4)`,
      [req.user.companyId ?? null, req.user.userId, req.user.userId, ip]
    );
  }
  ok(res, null, 'Disconnessione effettuata');
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await queryOne<Omit<UserRow, 'password_hash'>>(
    `SELECT id, company_id, name, surname, email, role, store_id, supervisor_id, status, is_super_admin, avatar_filename,
            registered_device_token, registered_device_identifier, device_reset_pending
     FROM users WHERE id = $1`,
    [req.user!.userId]
  );
  if (!user) {
    unauthorized(res, 'Utente non trovato', 'USER_NOT_FOUND');
    return;
  }
  ok(res, {
    id: user.id,
    companyId: user.company_id,
    storeId: user.store_id,
    supervisorId: user.supervisor_id,
    name: user.name,
    surname: user.surname,
    email: user.email,
    role: user.role,
    status: user.status,
    isSuperAdmin: user.is_super_admin,
    avatarFilename: user.avatar_filename,
    isDeviceRegistered: user.registered_device_token != null || user.registered_device_identifier != null,
    deviceResetPending: user.device_reset_pending === true,
    requiresDeviceRegistration:
      user.role !== 'admin' &&
      ((user.registered_device_token == null && user.registered_device_identifier == null) || user.device_reset_pending === true),
  });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  // Axios interceptor sends snake_case; Zod schema validated as snake_case
  const { current_password, new_password, refresh_token } = req.body as { current_password: string; new_password: string; refresh_token?: string };

  const user = await queryOne<{ password_hash: string; company_id: number | null }>(
    `SELECT password_hash, company_id FROM users WHERE id = $1`,
    [req.user!.userId]
  );

  if (!user || !(await bcrypt.compare(current_password, user.password_hash))) {
    unauthorized(res, 'Password attuale non corretta', 'INVALID_CURRENT_PASSWORD');
    return;
  }

  if (new_password.length < 8) {
    badRequest(res, 'La nuova password deve essere di almeno 8 caratteri', 'PASSWORD_TOO_SHORT');
    return;
  }

  const newHash = await bcrypt.hash(new_password, 12);
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, req.user!.userId]);
  // A new password ends every other session; the device making the change stays in.
  await revokeAllRefreshTokensForUser(req.user!.userId, refresh_token ?? null);

  // Return new token so client stays logged in
  const updatedUser = await queryOne<UserRow>(
    `SELECT id, company_id, name, surname, email, role, store_id, supervisor_id, status, is_super_admin FROM users WHERE id = $1`,
    [req.user!.userId]
  );

  const token = signTokenForUser(updatedUser!);

  ok(res, { token }, 'Password aggiornata con successo');
});

/**
 * PATCH /api/auth/locale
 * Persists the user's preferred locale to the database so that background jobs
 * (welcome emails, reminders, etc.) can generate notifications in the correct language.
 * Body: { locale: 'it' | 'en' }
 */
export const updateLocale = asyncHandler(async (req: Request, res: Response) => {
  const { locale } = req.body as { locale?: unknown };

  const SUPPORTED = ['it', 'en'];
  if (!locale || typeof locale !== 'string' || !SUPPORTED.includes(locale)) {
    badRequest(res, `Unsupported locale. Accepted values: ${SUPPORTED.join(', ')}`, 'INVALID_LOCALE');
    return;
  }

  await query(
    `UPDATE users SET locale = $1, updated_at = NOW() WHERE id = $2`,
    [locale, req.user!.userId],
  );

  ok(res, { locale }, 'Locale updated');
});

