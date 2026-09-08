import { Router } from 'express';
import { login, me } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.post('/login', asyncHandler(login));
router.get('/me', authenticate, asyncHandler(me));

export default router;
