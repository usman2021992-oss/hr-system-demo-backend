import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { query, queryOne } from '../config/database';

export async function listEmployees(req: Request, res: Response) {
  const companyId = req.user!.companyId;

  const employees = await query(
    `SELECT id, name, email, role, company_id, created_at
     FROM users
     WHERE company_id = $1
     ORDER BY name ASC`,
    [companyId]
  );

  res.json(employees);
}

export async function createEmployee(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const { name, email, role, password } = req.body;

  if (!name || !email || !role || !password) {
    res.status(400).json({ error: 'name, email, role, and password are required' });
    return;
  }

  const validRoles = ['admin', 'manager', 'employee'];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: 'Role must be admin, manager, or employee' });
    return;
  }

  const existing = await queryOne(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  if (existing) {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }

  const password_hash = await bcrypt.hash(password, 10);

  const [employee] = await query(
    `INSERT INTO users (company_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, company_id, created_at`,
    [companyId, name, email.toLowerCase(), password_hash, role]
  );

  res.status(201).json(employee);
}

export async function updateEmployee(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const { id } = req.params;
  const { name, role } = req.body;

  // Ensure employee belongs to caller's company
  const existing = await queryOne(
    'SELECT id FROM users WHERE id = $1 AND company_id = $2',
    [id, companyId]
  );
  if (!existing) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const [updated] = await query(
    `UPDATE users SET name = COALESCE($1, name), role = COALESCE($2, role),
     updated_at = NOW()
     WHERE id = $3 AND company_id = $4
     RETURNING id, name, email, role, company_id, created_at`,
    [name, role, id, companyId]
  );

  res.json(updated);
}

export async function deleteEmployee(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const { id } = req.params;

  // Prevent self-deletion
  if (parseInt(id) === req.user!.userId) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }

  const emp = await queryOne<{ avatar_filename: string | null }>(
    `SELECT avatar_filename FROM users WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  
  if (emp && emp.avatar_filename) {
    const uploadDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads', 'avatars');
    const filePath = path.join(uploadDir, emp.avatar_filename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Failed to delete physical avatar on user delete:', err);
    }
  }

  const result = await query(
    'DELETE FROM users WHERE id = $1 AND company_id = $2 RETURNING id',
    [id, companyId]
  );

  if (!result.length) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  res.json({ message: 'Employee deleted' });
}
