-- ---------------------------------------------------------------------------
-- 143. Refresh tokens, so a session can outlive its 8-hour access token.
--
--      The access token (JWT) expires 8 hours after login. An employee who
--      clocks in at the start of a shift and leaves the phone in a pocket
--      finds it expired when scanning the terminal QR at the end of the shift,
--      and the clock-out is lost while they log in again.
--
--      A refresh token is a long random string handed out at login. When the
--      access token expires, the client trades it here for a new access token
--      without asking for the password. Only its SHA-256 hash is stored, so a
--      database leak does not hand out live sessions.
--
--      expires_at slides forward on every use; absolute_expires_at never moves,
--      so a session cannot be kept alive forever. Logout, a password change or
--      deactivating the user ends it (revoked_at / status check).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash          CHAR(64) NOT NULL UNIQUE,
  remember_me         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  user_agent          TEXT,
  ip_address          VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user
  ON auth_refresh_tokens(user_id) WHERE revoked_at IS NULL;
