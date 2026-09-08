import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
  listSettings,
  updateSetting,
  getRecentRecipients,
  listAutomationSettings,
  updateAutomationSetting,
} from './notifications.controller';

const router = Router();

// ---------------------------------------------------------------------------
// IMPORTANT: static path routes must be declared BEFORE the dynamic /:id/read
// route to prevent Express from matching the literal strings "read-all",
// "unread-count", and "settings" as values of the :id parameter.
// ---------------------------------------------------------------------------

// GET /api/notifications
// Returns paginated notifications for the authenticated user
router.get('/', authenticate, listNotifications);

// PATCH /api/notifications/read-all
// Marks all notifications as read for the authenticated user
// NOTE: Declared before /:id/read to avoid "read-all" being captured as :id
router.patch('/read-all', authenticate, markAllNotificationsRead);

// DELETE /api/notifications/bulk-delete
// Deletes multiple notifications by IDs
router.delete('/bulk-delete', authenticate, require('../../modules/notifications/notifications.controller').bulkDeleteNotifications);

// GET /api/notifications/unread-count
// Returns { count: number } for the bell-badge polling
// NOTE: Declared before /:id/read for the same reason
router.get('/unread-count', authenticate, getUnreadCount);

// GET /api/notifications/settings
// Returns all notification settings for the user's company (Admin/HR only)
// NOTE: Declared before /:id/read for the same reason
router.get(
  '/settings',
  authenticate,
  requireRole('admin', 'hr'),
  listSettings,
);

// PATCH /api/notifications/settings/:eventKey
// Creates or updates a notification setting (Admin only)
router.patch(
  '/settings/:eventKey',
  authenticate,
  requireRole('admin'),
  updateSetting,
);

// GET /api/notifications/settings/:eventKey/recipients
// Returns recent users who received this notification type (Admin/HR only)
router.get(
  '/settings/:eventKey/recipients',
  authenticate,
  requireRole('admin', 'hr'),
  getRecentRecipients,
);

// GET /api/notifications/automation-settings
router.get(
  '/automation-settings',
  authenticate,
  requireRole('admin'),
  listAutomationSettings,
);

// PATCH /api/notifications/automation-settings/:jobKey
router.patch(
  '/automation-settings/:jobKey',
  authenticate,
  requireRole('admin'),
  updateAutomationSetting,
);

// PATCH /api/notifications/:id/read
// Marks a single notification as read — declared LAST so static paths above
// are not shadowed
router.patch('/:id/read', authenticate, markNotificationRead);

export default router;
