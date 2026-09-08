import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, forbidden, notFound } from '../../utils/response';
import {
  getTemplates, createTemplate, updateTemplate, deleteTemplate,
  getEmployeeTasks, assignTasksToEmployee, completeTask, uncompleteTask,
  getOnboardingOverview, bulkAssignAll, getOnboardingStats,
} from './onboarding.service';
import { sendNotification } from '../notifications/notifications.service';
import { t } from '../../utils/i18n';
import { query, queryOne } from '../../config/database';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const listTemplatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }
  const requestedRaw = req.query.target_company_id;
  let scopedCompanyIds = allowedCompanyIds;
  if (requestedRaw != null) {
    const requestedId = parseInt(String(requestedRaw), 10);
    if (Number.isNaN(requestedId)) {
      badRequest(res, 'Invalid target company ID');
      return;
    }
    if (!allowedCompanyIds.includes(requestedId)) {
      forbidden(res, 'Company access denied');
      return;
    }
    scopedCompanyIds = [requestedId];
  }
  const includeInactive = req.query.include_inactive === 'true';
  const templates = await getTemplates(scopedCompanyIds, includeInactive);
  ok(res, { templates });
});

export const createTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }

  const { name, description, task_type, sort_order, category, due_days, link_url, priority, company_id } = req.body as Record<string, unknown>;
  const targetCompanyId = typeof company_id === 'number' ? company_id : user.companyId;
  if (!targetCompanyId || !allowedCompanyIds.includes(targetCompanyId)) {
    forbidden(res, 'Company access denied');
    return;
  }

  if (!name || typeof name !== 'string' || name.trim() === '') {
    badRequest(res, 'Name is required', 'VALIDATION_ERROR');
    return;
  }

  const template = await createTemplate(targetCompanyId, {
    name: name.trim(),
    description: typeof description === 'string' ? description : undefined,
    taskType: typeof task_type === 'string' ? task_type as any : undefined,
    sortOrder: typeof sort_order === 'number' ? sort_order : undefined,
    category: typeof category === 'string' ? category as any : undefined,
    dueDays: typeof due_days === 'number' ? due_days : undefined,
    linkUrl: typeof link_url === 'string' ? link_url : undefined,
    priority: typeof priority === 'string' ? priority as any : undefined,
    createdByUserId: user.userId,
  });

  created(res, { template }, 'Template created');
});

export const updateTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'Invalid ID'); return; }

  const { name, description, task_type, sort_order, is_active, category, due_days, link_url, priority, target_company_id } = req.body as Record<string, unknown>;
  const targetCompanyId = typeof target_company_id === 'number' ? target_company_id : user.companyId;
  if (!targetCompanyId || !allowedCompanyIds.includes(targetCompanyId)) {
    forbidden(res, 'Company access denied');
    return;
  }

  const updated = await updateTemplate(id, targetCompanyId, {
    name:        typeof name === 'string' ? name.trim() : undefined,
    description: typeof description === 'string' ? description : undefined,
    taskType:    typeof task_type === 'string' ? task_type as any : undefined,
    sortOrder:   typeof sort_order === 'number' ? sort_order : undefined,
    isActive:    typeof is_active === 'boolean' ? is_active : undefined,
    category:    typeof category === 'string' ? category as any : undefined,
    dueDays:     due_days === null ? null : typeof due_days === 'number' ? due_days : undefined,
    linkUrl:     link_url === null ? null : typeof link_url === 'string' ? link_url : undefined,
    priority:    typeof priority === 'string' ? priority as any : undefined,
  });

  if (!updated) { notFound(res, 'Template not found'); return; }
  ok(res, { template: updated }, 'Template updated');
});

// ---------------------------------------------------------------------------
// Employee Tasks
// ---------------------------------------------------------------------------

export const getEmployeeTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const { userId, role, is_super_admin } = user;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  // Employees can only view their own tasks
  if (role === 'employee' && employeeId !== userId && !is_super_admin) {
    forbidden(res, 'Access denied');
    return;
  }

  const employeeRow = await queryOne<{ company_id: number }>(
    `SELECT company_id
     FROM users
     WHERE id = $1
       AND status = 'active'
       AND company_id = ANY($2)`,
    [employeeId, allowedCompanyIds],
  );
  if (!employeeRow) { notFound(res, 'Employee not found or does not belong to this company'); return; }

  const progress = await getEmployeeTasks(employeeId, employeeRow.company_id);
  ok(res, { progress });
});

export const assignTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  // Verify the employee exists and is in an allowed company
  const empRow = await queryOne<{ id: number; locale?: string; company_id: number; name: string; surname: string }>(
    `SELECT id, locale, company_id, name, surname
     FROM users
     WHERE id = $1
       AND status = 'active'
       AND company_id = ANY($2)`,
    [employeeId, allowedCompanyIds],
  );
  if (!empRow) { notFound(res, 'Employee not found or does not belong to this company'); return; }

  // Get assigner details
  const assignerRow = await queryOne<{ name: string; surname: string }>(
    `SELECT name, surname FROM users WHERE id = $1`,
    [user.userId],
  );
  const assignerName = assignerRow 
    ? `${assignerRow.name}${assignerRow.surname ? ' ' + assignerRow.surname : ''}`
    : 'Admin';

  const { template_ids } = req.body as { template_ids?: number[] };
  const ids = Array.isArray(template_ids) ? template_ids : undefined;
  const count = await assignTasksToEmployee(employeeId, empRow.company_id, ids, user.userId);
  const locale = empRow.locale ?? 'it';

  // Get the assigned tasks details for the notification
  const assignedTasks = await query<{
    template_name: string;
    template_description: string | null;
    template_priority: string;
    due_date: string | null;
    template_category: string;
  }>(
    `SELECT 
       tmpl.name AS template_name,
       tmpl.description AS template_description,
       tmpl.priority AS template_priority,
       t.due_date,
       tmpl.category AS template_category
     FROM employee_onboarding_tasks t
     JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
     WHERE t.employee_id = $1 
       AND tmpl.company_id = $2
       AND t.assigned_by_user_id = $3
     ORDER BY 
       CASE tmpl.task_type
         WHEN 'day1' THEN 1
         WHEN 'week1' THEN 2
         WHEN 'month1' THEN 3
         WHEN 'ongoing' THEN 4
         ELSE 5
       END,
       tmpl.sort_order ASC
     LIMIT 5`,
    [employeeId, empRow.company_id, user.userId],
  );

  // Build detailed message with task information
  const employeeName = `${empRow.name}${empRow.surname ? ' ' + empRow.surname : ''}`;
  let detailedMessage = locale === 'en' 
    ? `Hi ${employeeName}, ${assignerName} has assigned you ${count} onboarding task${count > 1 ? 's' : ''}.\n\n`
    : `Ciao ${employeeName}, ${assignerName} ti ha assegnato ${count} attività di onboarding.\n\n`;

  if (assignedTasks.length > 0) {
    detailedMessage += locale === 'en' ? 'Tasks:\n' : 'Attività:\n';
    assignedTasks.forEach((task: {
      template_name: string;
      template_description: string | null;
      template_priority: string;
      due_date: string | null;
      template_category: string;
    }, index: number) => {
      const priorityEmoji = task.template_priority === 'high' ? '🔴' : task.template_priority === 'medium' ? '🟡' : '🟢';
      const dueDateText = task.due_date 
        ? (locale === 'en' ? ` (Due: ${task.due_date})` : ` (Scadenza: ${task.due_date})`)
        : '';
      detailedMessage += `${index + 1}. ${priorityEmoji} ${task.template_name}${dueDateText}\n`;
      if (task.template_description && index < 3) {
        const shortDesc = task.template_description.length > 60 
          ? task.template_description.substring(0, 60) + '...'
          : task.template_description;
        detailedMessage += `   ${shortDesc}\n`;
      }
    });
    
    if (count > assignedTasks.length) {
      detailedMessage += locale === 'en' 
        ? `\n...and ${count - assignedTasks.length} more task${count - assignedTasks.length > 1 ? 's' : ''}.`
        : `\n...e altre ${count - assignedTasks.length} attività.`;
    }
  }

  detailedMessage += locale === 'en'
    ? '\n\nLog in to the portal to view and complete your tasks.'
    : '\n\nAccedi al portale per visualizzare e completare le tue attività.';

  sendNotification({
    companyId: empRow.company_id,
    userId: employeeId,
    type: 'onboarding.welcome',
    title:   t(locale, 'notifications.onboarding_welcome_assigned.title'),
    message: detailedMessage,
    priority: 'high',
    locale,
  }).catch(() => undefined);

  ok(res, { assigned: count }, `${count} tasks assigned`);
});

export const completeTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const { userId, role } = user;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }

  const taskId = parseInt(req.params.taskId, 10);
  if (Number.isNaN(taskId)) { badRequest(res, 'Invalid task ID'); return; }

  // Admins/HR can complete tasks on behalf of any employee in their company.
  // Employees can only complete their own tasks (enforced by the service).
  const { note } = req.body as { note?: string };
  const isManager = ['admin', 'hr', 'area_manager', 'store_manager'].includes(role);
  let task = null;
  if (isManager) {
    const taskScopeRow = await queryOne<{ company_id: number }>(
      `SELECT tmpl.company_id
       FROM employee_onboarding_tasks t
       JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
       WHERE t.id = $1
         AND tmpl.company_id = ANY($2)`,
      [taskId, allowedCompanyIds],
    );
    if (!taskScopeRow) { notFound(res, 'Task not found or access denied'); return; }
    task = await completeTask(taskId, undefined, taskScopeRow.company_id, typeof note === 'string' ? note : undefined);
  } else {
    task = await completeTask(taskId, userId, undefined, typeof note === 'string' ? note : undefined);
  }

  if (!task) { notFound(res, 'Task not found or already completed'); return; }

  ok(res, { task }, 'Task completed');
});

export const deleteTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'Invalid ID'); return; }

  const requestedRaw = req.query.target_company_id;
  const targetCompanyId = requestedRaw != null ? parseInt(String(requestedRaw), 10) : user.companyId;
  if (!targetCompanyId || Number.isNaN(targetCompanyId) || !allowedCompanyIds.includes(targetCompanyId)) {
    forbidden(res, 'Company access denied');
    return;
  }

  const result = await deleteTemplate(id, targetCompanyId);
  if (!result.deleted && !result.deactivated) {
    notFound(res, 'Template not found');
    return;
  }

  const message = result.deactivated
    ? 'Template deactivated (has assigned tasks)'
    : 'Template deleted';
  ok(res, result, message);
});

export const getOverviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }

  const requestedRaw = req.query.target_company_id;
  let scopedCompanyIds = allowedCompanyIds;
  if (requestedRaw != null) {
    const requestedId = parseInt(String(requestedRaw), 10);
    if (Number.isNaN(requestedId)) {
      badRequest(res, 'Invalid target company ID');
      return;
    }
    if (!allowedCompanyIds.includes(requestedId)) {
      forbidden(res, 'Company access denied');
      return;
    }
    scopedCompanyIds = [requestedId];
  }

  const overview = await getOnboardingOverview(scopedCompanyIds);
  ok(res, { overview });
});

export const uncompleteTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const { role } = user;
  const allowedCompanyIds = await resolveAllowedCompanyIds(user);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'No company associated'); return; }
  if (role === 'employee') { forbidden(res, 'Access denied'); return; }

  const taskId = parseInt(req.params.taskId, 10);
  if (Number.isNaN(taskId)) { badRequest(res, 'Invalid task ID'); return; }

  const taskScopeRow = await queryOne<{ company_id: number }>(
    `SELECT tmpl.company_id
     FROM employee_onboarding_tasks t
     JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
     WHERE t.id = $1
       AND tmpl.company_id = ANY($2)`,
    [taskId, allowedCompanyIds],
  );
  if (!taskScopeRow) { notFound(res, 'Task not found or access denied'); return; }

  const task = await uncompleteTask(taskId, taskScopeRow.company_id);
  if (!task) { notFound(res, 'Task not found or not yet completed'); return; }
  ok(res, { task }, 'Task reset');
});

export const bulkAssignAllHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const result = await bulkAssignAll(companyId);

  ok(res, result, `Tasks assigned to ${result.employees} employees`);
});

export const getStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }
  const stats = await getOnboardingStats(companyId);
  ok(res, { stats });
});

export const sendReminderHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  // Verify the employee exists and belongs to this company
  const empRow = await queryOne<{ id: number; locale?: string }>(
    `SELECT id, locale FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    [employeeId, companyId],
  );
  if (!empRow) { notFound(res, 'Employee not found or does not belong to this company'); return; }

  const progress = await getEmployeeTasks(employeeId, companyId);
  const pending = progress.total - progress.completed;
  const locale = empRow.locale ?? 'it';

  sendNotification({
    companyId,
    userId: employeeId,
    type: 'onboarding.welcome',
    title:   t(locale, 'notifications.onboarding_reminder_manual.title'),
    message: t(locale, 'notifications.onboarding_reminder_manual.message', { count: pending }),
    priority: 'medium',
    locale,
  }).catch(() => undefined);

  ok(res, { sent: true }, 'Reminder sent');
});
