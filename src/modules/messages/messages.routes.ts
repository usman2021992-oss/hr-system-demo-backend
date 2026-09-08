import { Router } from 'express';
import { z } from 'zod';
import { sendMessage, listMessages, unreadCount, markAsRead, getHrRecipient, uploadAttachment, editMessage, deleteMessage } from './messages.controller';
import { authenticate, requireRole, enforceCompany, requireModulePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router();

const sendMessageSchema = z.object({
  // Frontend axios interceptor sends snake_case keys (recipient_id),
  // but some integrations/tests may still send recipientId.
  recipientId: z.number().int().positive().optional(),
  recipient_id: z.number().int().positive().optional(),
  company_id: z.number().int().positive().optional(),
  target_company_id: z.number().int().positive().optional(),
  subject: z.string().max(255).optional(),
  body: z.string().optional(),
  // Attachment support — the filename returned from the upload endpoint.
  // Accept both camelCase and snake_case variants.
  attachment_filename: z.string().optional(),
  attachmentFilename: z.string().optional(),
}).refine(
  (data) => data.recipientId != null || data.recipient_id != null,
  { message: 'recipientId è obbligatorio', path: ['recipientId'] }
);

// Unread count — must come before '/' to avoid route conflict
router.get(
  '/unread-count',
  authenticate,
  enforceCompany,
  requireModulePermission('messaggi', 'read'),
  unreadCount,
);

// Inbox for current user
router.get(
  '/',
  authenticate,
  enforceCompany,
  requireModulePermission('messaggi', 'read'),
  listMessages,
);

// Send message — management roles only
router.post(
  '/',
  authenticate,
  enforceCompany,
  requireRole('admin', 'hr', 'area_manager', 'store_manager', 'employee'),
  requireModulePermission('messaggi', 'write'),
  validate(sendMessageSchema),
  sendMessage,
);

// HR recipient helper (for employee chat UI) — must come before /:id/read to avoid shadowing
router.get(
  '/hr',
  authenticate,
  enforceCompany,
  requireModulePermission('messaggi', 'read'),
  getHrRecipient,
);

import multer from 'multer';
import path from 'path';
import fs from 'fs';

const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = process.env.UPLOADS_DIR
      ? path.dirname(process.env.UPLOADS_DIR)
      : path.join(process.cwd(), 'uploads');
    const dir = path.join(uploadsDir, 'message-attachments');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `attachment-${uniqueSuffix}${ext}`);
  },
});

const uploadAttachmentMulter = multer({
  storage: attachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Formato file non supportato. Solo immagini (PNG, JPG, JPEG, GIF, WEBP).'));
    }
    cb(null, true);
  },
});

// Mark as read — any authenticated user (access control in controller)
router.patch(
  '/:id/read',
  authenticate,
  enforceCompany,
  requireModulePermission('messaggi', 'write'),
  markAsRead,
);

// Edit message — sender only (access control in controller)
router.patch(
  '/:id',
  authenticate,
  enforceCompany,
  requireModulePermission('messaggi', 'write'),
  editMessage,
);

// Delete message — sender only (access control in controller)
router.delete(
  '/:id',
  authenticate,
  enforceCompany,
  requireModulePermission('messaggi', 'write'),
  deleteMessage,
);

// Upload attachment
router.post(
  '/upload-attachment',
  authenticate,
  enforceCompany,
  requireRole('admin', 'hr', 'area_manager', 'store_manager', 'employee'),
  requireModulePermission('messaggi', 'write'),
  (req, res, next) => {
    uploadAttachmentMulter.single('attachment')(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
      next();
    });
  },
  uploadAttachment,
);

export default router;
