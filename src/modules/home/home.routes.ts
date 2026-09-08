import { Router } from 'express';
import { getHomeData } from './home.controller';
import { authenticate, enforceCompany } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, enforceCompany, getHomeData);

export default router;
