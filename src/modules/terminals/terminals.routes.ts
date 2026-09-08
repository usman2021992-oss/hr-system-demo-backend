import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { listTerminals, listStoresWithTerminalStatus, createTerminal, updateTerminal, deleteTerminal } from './terminals.controller';

const router = Router();

// All terminal routes require authentication
router.use(authenticate);

// GET /api/terminals - List and filter terminal accounts
router.get('/', listTerminals);

// GET /api/terminals/stores-status - List stores with their terminal creation status
router.get('/stores-status', listStoresWithTerminalStatus);

// POST /api/terminals - Manually create a terminal account
router.post('/', createTerminal);

// PATCH /api/terminals/:id - Update a terminal account
router.patch('/:id', updateTerminal);

// DELETE /api/terminals/:id - Delete a terminal account
router.delete('/:id', deleteTerminal);

export default router;
