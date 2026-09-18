import crypto from 'crypto';
import { query, queryOne } from '../../config/database';

/**
 * Refresh tokens keep a session alive past the 8-hour access token, so an
 * employee who scans the terminal QR at the end of a long shift is not bounced
 * to the login page (and does not lose the clock-out).
 *
 * Deliberately NOT rotated on use: a sessionStorage session is copied into
 * every tab opened from it, and with rotation the first tab to refresh would
 * invalidate the copy held by the others and log them out. Instead the token
 * slides its idle expiry forward on each use, never past a fixed absolute
 * limit, and is revoked server-side on logout, on a password change, and
 * refused as soon as the user is deactivated.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Idle window (slides on every refresh) and absolute cap (never moves).
const LIFETIME = {
  session:  { idleMs: 24 * HOUR_MS, absoluteMs: 7 * DAY_MS },
  remember: { idleMs: 14 * DAY_MS,  absoluteMs: 60 * DAY_MS },
};

export interface RefreshTokenRow {
  id: number;
  user_id: number;
  remember_me: boolean;
  expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(
  userId: number,
  rememberMe: boolean,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<string> {
  const token = crypto.randomBytes(48).toString('base64url');
  const life = rememberMe ? LIFETIME.remember : LIFETIME.session;
  const now = Date.now();
  await query(
    `INSERT INTO auth_refresh_tokens
       (user_id, token_hash, remember_me, expires_at, absolute_expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      hashRefreshToken(token),
      rememberMe,
      new Date(now + life.idleMs),
      new Date(now + life.absoluteMs),
      meta.userAgent?.slice(0, 500) ?? null,
      meta.ip?.slice(0, 64) ?? null,
    ],
  );

  // Best-effort housekeeping — never fails the caller.
  query(
    `DELETE FROM auth_refresh_tokens
     WHERE expires_at < NOW() - INTERVAL '7 days'
        OR absolute_expires_at < NOW() - INTERVAL '7 days'
        OR revoked_at < NOW() - INTERVAL '7 days'`,
    [],
  ).catch(() => {});

  return token;
}

/** Returns the row when the token is live, otherwise null. */
export async function findLiveRefreshToken(token: string): Promise<RefreshTokenRow | null> {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  return queryOne<RefreshTokenRow>(
    `SELECT id, user_id, remember_me, expires_at, absolute_expires_at, revoked_at
     FROM auth_refresh_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND absolute_expires_at > NOW()`,
    [hashRefreshToken(token)],
  );
}

/** Slides the idle expiry forward, capped at the absolute expiry. */
export async function touchRefreshToken(row: RefreshTokenRow): Promise<void> {
  const life = row.remember_me ? LIFETIME.remember : LIFETIME.session;
  const next = new Date(Math.min(Date.now() + life.idleMs, new Date(row.absolute_expires_at).getTime()));
  await query(
    `UPDATE auth_refresh_tokens SET last_used_at = NOW(), expires_at = $2 WHERE id = $1`,
    [row.id, next],
  );
}

export async function revokeRefreshToken(token: string): Promise<void> {
  if (!token || typeof token !== 'string' || token.length > 200) return;
  await query(
    `UPDATE auth_refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashRefreshToken(token)],
  );
}

/**
 * Ends every session of a user — used when their password changes. `keepToken`
 * spares the session that made the change, so the user is not logged out of
 * the device they are using.
 */
export async function revokeAllRefreshTokensForUser(userId: number, keepToken?: string | null): Promise<void> {
  const keepHash = keepToken && typeof keepToken === 'string' ? hashRefreshToken(keepToken) : null;
  await query(
    `UPDATE auth_refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL
       AND ($2::text IS NULL OR token_hash <> $2)`,
    [userId, keepHash],
  );
}
