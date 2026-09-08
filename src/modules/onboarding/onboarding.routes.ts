import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  listTemplatesHandler, createTemplateHandler, updateTemplateHandler, deleteTemplateHandler,
  getEmployeeTasksHandler, assignTasksHandler, completeTaskHandler, uncompleteTaskHandler,
  getOverviewHandler, bulkAssignAllHandler, getStatsHandler, sendReminderHandler,
} from './onboarding.controller';

const router = Router();

router.use(authenticate);

// Templates — admin/HR/area_manager
router.get('/templates',        requireRole('admin', 'hr', 'area_manager'), listTemplatesHandler);
router.post('/templates',       requireRole('admin', 'hr', 'area_manager'), createTemplateHandler);
router.patch('/templates/:id',  requireRole('admin', 'hr', 'area_manager'), updateTemplateHandler);
router.delete('/templates/:id', requireRole('admin', 'hr', 'area_manager'), deleteTemplateHandler);

// Employee onboarding tasks
router.get('/employees/:employeeId/tasks',          getEmployeeTasksHandler);
router.post('/employees/:employeeId/tasks/assign',  requireRole('admin', 'hr', 'area_manager'), assignTasksHandler);
router.post('/employees/:employeeId/remind',        requireRole('admin', 'hr', 'area_manager'), sendReminderHandler);

// Task state
router.patch('/tasks/:taskId/complete',             completeTaskHandler);
router.patch('/tasks/:taskId/uncomplete',           requireRole('admin', 'hr', 'area_manager'), uncompleteTaskHandler);

// Overview + stats — admin/HR/area_manager
router.get('/overview', requireRole('admin', 'hr', 'area_manager'), getOverviewHandler);
router.get('/stats',    requireRole('admin', 'hr', 'area_manager'), getStatsHandler);

// Bulk actions
router.post('/bulk-assign', requireRole('admin', 'hr', 'area_manager'), bulkAssignAllHandler);

export default router;
