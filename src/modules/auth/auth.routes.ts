import { Router } from 'express';
import { z } from 'zod';
import { login, logout, me, changePassword, updateLocale } from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

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
});

router.post('/login', validate(loginSchema), login);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);
router.put('/password', authenticate, validate(changePasswordSchema), changePassword);
router.patch('/locale', authenticate, updateLocale);

export default router;
