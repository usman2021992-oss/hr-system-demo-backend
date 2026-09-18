import { Router } from 'express';
import { z } from 'zod';
import { login, logout, me, changePassword, updateLocale, refresh } from './auth.controller';
import { authenticate, optionalAuthenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { rateLimit } from '../../middleware/rateLimit';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(1, 'Password obbligatoria'),
  // Axios interceptor sends snake_case; keep both for safety
  remember_me: z.boolean().optional(),
  rememberMe: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  // Axios interceptor converts camelCase → snake_case before sending
  current_password: z.string().min(1, 'Password attuale obbligatoria'),
  new_password: z.string().min(8, 'La nuova password deve essere di almeno 8 caratteri'),
  // The caller's own refresh token, spared when every other session is ended.
  refresh_token: z.string().max(200).optional(),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1).max(200),
});

const logoutSchema = z.object({
  refresh_token: z.string().max(200).optional(),
}).passthrough();

// A session refreshes about once every 8 hours; a whole store behind one NAT
// address stays far below this.
const refreshLimiter = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'auth-refresh' });

router.post('/login', validate(loginSchema), login);
router.post('/refresh', refreshLimiter, validate(refreshSchema), refresh);
router.post('/logout', optionalAuthenticate, validate(logoutSchema), logout);
router.get('/me', authenticate, me);
router.put('/password', authenticate, validate(changePasswordSchema), changePassword);
router.patch('/locale', authenticate, updateLocale);

export default router;
