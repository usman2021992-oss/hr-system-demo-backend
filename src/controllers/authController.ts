import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne } from '../config/database';
import { signAuthToken, UserRole } from '../config/jwt';

interface UserRow {
  id: number;
  company_id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_super_admin: boolean;
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = await queryOne<UserRow>(
    'SELECT id, company_id, name, email, password_hash, role, is_super_admin FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signAuthToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    companyId: user.company_id,
    storeId: null,
    supervisorId: null,
    is_super_admin: user.is_super_admin,
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
    },
  });
}

export async function me(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const user = await queryOne<UserRow>(
    'SELECT id, company_id, name, email, role, store_id, supervisor_id, is_super_admin FROM users WHERE id = $1',
    [req.user.userId]
  );

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companyId: user.company_id,
    storeId: (user as any).store_id ?? null,
    supervisorId: (user as any).supervisor_id ?? null,
    isSuperAdmin: user.is_super_admin,
  });
}
