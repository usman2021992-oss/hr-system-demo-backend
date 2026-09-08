import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';

export function auditLog(entityType: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Capture the original json method
    const originalJson = res.json.bind(res);
    const startBody = req.body ? { ...req.body } : {};
    // Remove sensitive fields from audit
    delete startBody.password;
    delete startBody.password_hash;
    delete startBody.iban;

    res.json = function (body: any) {
      // Only log on successful mutations (2xx responses)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const action = methodToAction(req.method);
        const entityId = req.params?.id ? parseInt(req.params.id, 10) : (body?.data?.id ?? null);
        const ip = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || null;

        query(
          `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, old_data, new_data, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.user.companyId,
            req.user.userId,
            action,
            entityType,
            entityId,
            req.method === 'PUT' || req.method === 'PATCH' ? startBody : null,
            req.method !== 'DELETE' ? (body?.data ?? startBody) : null,
            ip,
          ]
        ).catch((err) => console.error('Audit log failed:', err));
      }
      return originalJson(body);
    };

    next();
  };
}

function methodToAction(method: string): string {
  switch (method.toUpperCase()) {
    case 'POST': return 'CREATE';
    case 'PUT':
    case 'PATCH': return 'UPDATE';
    case 'DELETE': return 'DELETE';
    default: return method.toUpperCase();
  }
}
