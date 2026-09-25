import { Router } from 'express';
import { authenticate, requireRole, requireSuperAdmin } from '../../middleware/auth';
import { requireModulePermission } from '../../middleware/auth';
import { auditLog } from '../../middleware/auditLog';
import {
  listTerminals,
  listStoresWithTerminalStatus,
  createTerminal,
  updateTerminal,
  deleteTerminal,
  restoreTerminal,
  permanentlyDeleteTerminal,
  activateTerminal,
  deactivateTerminal,
  revealTerminalPassword,
} from './terminals.controller';

const router = Router();

/**
 * Who may do what with a terminal.
 *
 * A terminal is both a cost and a dependency: creating one adds to the
 * subscription, and switching one off stops a store taking attendance. Until
 * now every one of these routes was open to any authenticated user in the
 * company — an employee could read the terminal passwords out of the list and
 * sign in as the store terminal.
 *
 * Area and store managers can see terminals, because they need to know whether
 * their store is set up; they cannot change them. Deleting is narrower still:
 * an admin archives a terminal into the Super Admin's deleted view, and only
 * the Super Admin restores it or removes it for good.
 */
const terminalViewers = ['admin', 'hr', 'area_manager', 'store_manager'] as const;
const terminalManagers = ['admin', 'hr'] as const;
const terminalDeleters = ['admin'] as const;

// All terminal routes require authentication
router.use(authenticate);

// GET /api/terminals - List and filter terminal accounts
router.get('/', requireRole(...terminalViewers), requireModulePermission('terminali', 'read'), listTerminals);

// GET /api/terminals/stores-status - List stores with their terminal creation status
router.get('/stores-status', requireRole(...terminalViewers), requireModulePermission('terminali', 'read'), listStoresWithTerminalStatus);

// GET /api/terminals/:id/password - Reveal one password, and record that it was read
router.get('/:id/password', requireRole(...terminalManagers), requireModulePermission('terminali', 'write'), revealTerminalPassword);

// POST /api/terminals - Manually create a terminal account
router.post('/', requireRole(...terminalManagers), requireModulePermission('terminali', 'write'), auditLog('terminal'), createTerminal);

// PATCH /api/terminals/:id - Update a terminal account
router.patch('/:id', requireRole(...terminalManagers), requireModulePermission('terminali', 'write'), auditLog('terminal'), updateTerminal);

// PATCH /api/terminals/:id/activate|deactivate - Normal on/off, licence-checked on the way back
router.patch('/:id/activate', requireRole(...terminalManagers), requireModulePermission('terminali', 'write'), auditLog('terminal'), activateTerminal);
router.patch('/:id/deactivate', requireRole(...terminalManagers), requireModulePermission('terminali', 'write'), auditLog('terminal'), deactivateTerminal);

// DELETE /api/terminals/:id - Archive into the Super Admin's deleted view
router.delete('/:id', requireRole(...terminalDeleters), requireModulePermission('terminali', 'write'), auditLog('terminal'), deleteTerminal);

// Super Admin only: the deleted view's two actions.
router.post('/:id/restore', requireSuperAdmin, auditLog('terminal'), restoreTerminal);
router.delete('/:id/permanent', requireSuperAdmin, auditLog('terminal'), permanentlyDeleteTerminal);

export default router;
