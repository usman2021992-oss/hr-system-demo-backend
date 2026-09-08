import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { checkin, syncOfflineAttendance, listAttendance } from '../controllers/attendanceController';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(listAttendance));
router.post('/checkin', asyncHandler(checkin));
router.post('/sync', asyncHandler(syncOfflineAttendance));

export default router;
