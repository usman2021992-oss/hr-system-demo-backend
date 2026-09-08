import { query, queryOne } from '../../config/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnboardingTemplate {
  id: number;
  companyId: number;
  companyName?: string;
  name: string;
  description: string | null;
  taskType: 'day1' | 'week1' | 'month1' | 'ongoing';
  sortOrder: number;
  isActive: boolean;
  category:
    | 'profile_setup'
    | 'hr_compliance'
    | 'system_access'
    | 'training'
    | 'operations'
    | 'scheduling_shifts'
    | 'performance'
    | 'communication'
    | 'it_tools'
    | 'inventory'
    | 'customer_service'
    | 'finance_payroll'
    | 'hr_docs'
    | 'it_setup'
    | 'meeting'
    | 'other';
  dueDays: number | null;
  linkUrl: string | null;
  priority: 'high' | 'medium' | 'low';
  createdByUserId: number | null;
  createdByName: string | null;
  createdByAvatarFilename: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingTask {
  id: number;
  employeeId: number;
  templateId: number;
  templateName: string;
  templateDescription: string | null;
  templateTaskType: 'day1' | 'week1' | 'month1' | 'ongoing';
  templateCategory: OnboardingTemplate['category'];
  templateLinkUrl: string | null;
  templatePriority: 'high' | 'medium' | 'low';
  assignedByUserId: number | null;
  assignedByName: string | null;
  assignedByAvatarFilename: string | null;
  completed: boolean;
  completedAt: string | null;
  completionNote: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingProgress {
  total: number;
  completed: number;
  percentage: number;
  tasks: OnboardingTask[];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapTemplate(row: Record<string, unknown>): OnboardingTemplate {
  return {
    id: row.id as number,
    companyId: row.company_id as number,
    companyName: (row.company_name as string | undefined) ?? undefined,
    name: row.name as string,
    description: row.description as string | null,
    taskType: (row.task_type as OnboardingTemplate['taskType']) ?? 'day1',
    sortOrder: row.sort_order as number,
    isActive: row.is_active as boolean,
    category: (row.category as OnboardingTemplate['category']) ?? 'other',
    dueDays: (row.due_days as number | null) ?? null,
    linkUrl: (row.link_url as string | null) ?? null,
    priority: (row.priority as OnboardingTemplate['priority']) ?? 'medium',
    createdByUserId: (row.created_by_user_id as number | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
    createdByAvatarFilename: (row.created_by_avatar_filename as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapTask(row: Record<string, unknown>): OnboardingTask {
  const dueDate = row.due_date as string | null;
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = !!(dueDate && !(row.completed as boolean) && dueDate < today);
  return {
    id: row.id as number,
    employeeId: row.employee_id as number,
    templateId: row.template_id as number,
    templateName: row.template_name as string,
    templateDescription: row.template_description as string | null,
    templateTaskType: (row.template_task_type as OnboardingTask['templateTaskType']) ?? 'day1',
    templateCategory: (row.template_category as OnboardingTask['templateCategory']) ?? 'other',
    templateLinkUrl: row.template_link_url as string | null,
    templatePriority: (row.template_priority as OnboardingTask['templatePriority']) ?? 'medium',
    assignedByUserId: (row.assigned_by_user_id as number | null) ?? null,
    assignedByName: (row.assigned_by_name as string | null) ?? null,
    assignedByAvatarFilename: (row.assigned_by_avatar_filename as string | null) ?? null,
    completed: row.completed as boolean,
    completedAt: row.completed_at as string | null,
    completionNote: row.completion_note as string | null,
    dueDate,
    isOverdue,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function getTemplates(
  companyIds: number[],
  includeInactive = false,
): Promise<OnboardingTemplate[]> {
  if (companyIds.length === 0) return [];
  const rows = await query<Record<string, unknown>>(
    `SELECT tmpl.*, c.name AS company_name,
            CASE
              WHEN u.id IS NULL THEN NULL
              WHEN COALESCE(u.surname, '') = '' THEN u.name
              ELSE u.name || ' ' || u.surname
            END AS created_by_name,
            u.avatar_filename AS created_by_avatar_filename
     FROM onboarding_templates tmpl
     JOIN companies c ON c.id = tmpl.company_id
     LEFT JOIN users u ON u.id = tmpl.created_by_user_id
     WHERE tmpl.company_id = ANY($1) ${includeInactive ? '' : 'AND tmpl.is_active = TRUE'}
     ORDER BY
       CASE tmpl.task_type
         WHEN 'day1' THEN 1
         WHEN 'week1' THEN 2
         WHEN 'month1' THEN 3
         WHEN 'ongoing' THEN 4
         ELSE 5
       END,
       tmpl.sort_order ASC, tmpl.id ASC`,
    [companyIds],
  );
  return rows.map(mapTemplate);
}

export async function getTemplate(id: number, companyId: number): Promise<OnboardingTemplate | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT tmpl.*, c.name AS company_name,
            CASE
              WHEN u.id IS NULL THEN NULL
              WHEN COALESCE(u.surname, '') = '' THEN u.name
              ELSE u.name || ' ' || u.surname
            END AS created_by_name,
            u.avatar_filename AS created_by_avatar_filename
     FROM onboarding_templates tmpl
     JOIN companies c ON c.id = tmpl.company_id
     LEFT JOIN users u ON u.id = tmpl.created_by_user_id
     WHERE tmpl.id = $1 AND tmpl.company_id = $2`,
    [id, companyId],
  );
  return row ? mapTemplate(row) : null;
}

export async function createTemplate(
  companyId: number,
  data: {
    name: string;
    description?: string;
    createdByUserId?: number;
    taskType?: OnboardingTemplate['taskType'];
    sortOrder?: number;
    category?: OnboardingTemplate['category'];
    dueDays?: number;
    linkUrl?: string;
    priority?: OnboardingTemplate['priority'];
  },
): Promise<OnboardingTemplate> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO onboarding_templates
       (company_id, name, description, task_type, sort_order, category, due_days, link_url, priority, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      companyId,
      data.name,
      data.description ?? null,
      data.taskType ?? 'day1',
      data.sortOrder ?? 0,
      data.category ?? 'other',
      data.dueDays ?? null,
      data.linkUrl ?? null,
      data.priority ?? 'medium',
      data.createdByUserId ?? null,
    ],
  );
  return mapTemplate(row!);
}

export async function updateTemplate(
  id: number,
  companyId: number,
  data: {
    name?: string;
    description?: string;
    taskType?: OnboardingTemplate['taskType'];
    sortOrder?: number;
    isActive?: boolean;
    category?: OnboardingTemplate['category'];
    dueDays?: number | null;
    linkUrl?: string | null;
    priority?: OnboardingTemplate['priority'];
  },
): Promise<OnboardingTemplate | null> {
  const setParts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined)        { setParts.push(`name = $${idx++}`);        params.push(data.name); }
  if (data.description !== undefined) { setParts.push(`description = $${idx++}`); params.push(data.description); }
  if (data.taskType !== undefined)    { setParts.push(`task_type = $${idx++}`);    params.push(data.taskType); }
  if (data.sortOrder !== undefined)   { setParts.push(`sort_order = $${idx++}`);  params.push(data.sortOrder); }
  if (data.isActive !== undefined)    { setParts.push(`is_active = $${idx++}`);   params.push(data.isActive); }
  if (data.category !== undefined)    { setParts.push(`category = $${idx++}`);    params.push(data.category); }
  if (data.dueDays !== undefined)     { setParts.push(`due_days = $${idx++}`);    params.push(data.dueDays); }
  if (data.linkUrl !== undefined)     { setParts.push(`link_url = $${idx++}`);    params.push(data.linkUrl); }
  if (data.priority !== undefined)    { setParts.push(`priority = $${idx++}`);    params.push(data.priority); }

  if (setParts.length === 0) return getTemplate(id, companyId);

  setParts.push(`updated_at = NOW()`);
  params.push(id, companyId);

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE onboarding_templates SET ${setParts.join(', ')}
     WHERE id = $${idx++} AND company_id = $${idx++}
     RETURNING *`,
    params,
  );
  return row ? mapTemplate(row) : null;
}

export async function deleteTemplate(
  id: number,
  companyId: number,
): Promise<{ deleted: boolean; deactivated: boolean }> {
  // Check if any tasks reference this template
  const usage = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM employee_onboarding_tasks WHERE template_id = $1`,
    [id],
  );
  const hasUsage = parseInt(usage?.count ?? '0', 10) > 0;

  if (hasUsage) {
    // Soft-delete: deactivate instead of hard delete
    const row = await queryOne<{ id: number }>(
      `UPDATE onboarding_templates SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId],
    );
    return { deleted: false, deactivated: row != null };
  }

  const row = await queryOne<{ id: number }>(
    `DELETE FROM onboarding_templates WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, companyId],
  );
  return { deleted: row != null, deactivated: false };
}

export interface EmployeeOnboardingOverview {
  employeeId: number;
  companyId: number;
  companyName: string;
  name: string;
  surname: string;
  email: string;
  storeId: number | null;
  storeName: string | null;
  avatarFilename: string | null;
  total: number;
  completed: number;
  percentage: number;
  hasTasksAssigned: boolean;
}

export async function getOnboardingOverview(companyIds: number[]): Promise<EmployeeOnboardingOverview[]> {
  if (companyIds.length === 0) return [];
  const rows = await query<{
     employee_id: number;
    company_id: number;
    company_name: string;
    name: string;
    surname: string;
    email: string;
    role: string;
    store_id: number | null;
    store_name: string | null;
    avatar_filename: string | null;
    total: string;
    completed: string;
  }>(
    `SELECT
       u.id AS employee_id,
       u.company_id,
       c.name AS company_name,
       u.name,
       u.surname,
       u.email,
       u.role,
       s.id AS store_id,
       s.name AS store_name,
       u.avatar_filename,
       COUNT(t.id)::text AS total,
       COUNT(t.id) FILTER (WHERE t.completed = TRUE)::text AS completed
     FROM users u
     JOIN companies c ON c.id = u.company_id
     LEFT JOIN stores s ON s.id = u.store_id
     LEFT JOIN employee_onboarding_tasks t ON t.employee_id = u.id
     LEFT JOIN onboarding_templates tmpl ON tmpl.id = t.template_id AND tmpl.company_id = u.company_id
     WHERE u.company_id = ANY($1)
       AND u.role NOT IN ('admin', 'store_terminal')
       AND u.status = 'active'
     GROUP BY u.id, u.company_id, c.name, u.name, u.surname, u.email, u.role, s.id, s.name, u.avatar_filename
     ORDER BY u.surname ASC, u.name ASC`,
    [companyIds],
  );

  return rows.map((r) => {
    const total = parseInt(r.total, 10);
    const completed = parseInt(r.completed, 10);
    return {
      employeeId: r.employee_id,
      companyId: r.company_id,
      companyName: r.company_name,
      name: r.name,
      surname: r.surname,
      email: r.email,
      role: r.role as any,
      storeId: r.store_id,
      storeName: r.store_name,
      avatarFilename: r.avatar_filename,
      total,
      completed,
      percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
      hasTasksAssigned: total > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Employee Tasks
// ---------------------------------------------------------------------------

export async function getEmployeeTasks(
  employeeId: number,
  companyId: number,
): Promise<OnboardingProgress> {
  const rows = await query<Record<string, unknown>>(
    `SELECT t.id, t.employee_id, t.template_id, t.completed, t.completed_at,
            t.completion_note, t.due_date, t.created_at, t.updated_at,
            t.assigned_by_user_id,
            tmpl.name AS template_name, tmpl.description AS template_description,
            tmpl.task_type AS template_task_type,
            tmpl.category AS template_category, tmpl.link_url AS template_link_url,
            tmpl.priority AS template_priority,
            CASE
              WHEN assigner.id IS NULL THEN NULL
              WHEN COALESCE(assigner.surname, '') = '' THEN assigner.name
              ELSE assigner.name || ' ' || assigner.surname
            END AS assigned_by_name,
            assigner.avatar_filename AS assigned_by_avatar_filename
     FROM employee_onboarding_tasks t
     JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
     LEFT JOIN users assigner ON assigner.id = t.assigned_by_user_id
     WHERE t.employee_id = $1 AND tmpl.company_id = $2
     ORDER BY
       CASE tmpl.task_type
         WHEN 'day1' THEN 1
         WHEN 'week1' THEN 2
         WHEN 'month1' THEN 3
         WHEN 'ongoing' THEN 4
         ELSE 5
       END,
       tmpl.sort_order ASC, tmpl.id ASC`,
    [employeeId, companyId],
  );

  const tasks = rows.map(mapTask);
  const completed = tasks.filter((t) => t.completed).length;
  const total = tasks.length;

  return {
    total,
    completed,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    tasks,
  };
}

export async function assignTasksToEmployee(
  employeeId: number,
  companyId: number,
  templateIds?: number[],
  assignedByUserId?: number | null,
): Promise<number> {
  const templates = templateIds
    ? (await Promise.all(templateIds.map((id) => getTemplate(id, companyId)))).filter(Boolean) as OnboardingTemplate[]
    : await getTemplates([companyId]);

  // Get employee hire date for due_date calculation
  const emp = await queryOne<{ hire_date: string | null }>(
    `SELECT hire_date FROM users WHERE id = $1`,
    [employeeId],
  );
  const hireDate = emp?.hire_date ? new Date(emp.hire_date) : new Date();

  let assigned = 0;
  for (const tmpl of templates) {
    const dueDate = tmpl.dueDays != null
      ? new Date(hireDate.getTime() + tmpl.dueDays * 86400000).toISOString().slice(0, 10)
      : null;

    const upserted = await query<{ was_inserted: boolean }>(
      `INSERT INTO employee_onboarding_tasks (employee_id, template_id, due_date, assigned_by_user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, template_id) DO UPDATE SET
         assigned_by_user_id = EXCLUDED.assigned_by_user_id,
         updated_at = NOW()
       RETURNING (xmax = 0) AS was_inserted`,
      [employeeId, tmpl.id, dueDate, assignedByUserId ?? null],
    );
    if (upserted[0]?.was_inserted) assigned++;
  }
  return assigned;
}

export async function completeTask(
  taskId: number,
  employeeId?: number,
  companyId?: number,
  note?: string,
): Promise<OnboardingTask | null> {
  let row: Record<string, unknown> | null;

  if (employeeId) {
    // Employee completing their own task — filter by employee_id
    // Use CTE to avoid referencing the update-target alias in FROM-clause JOINs
    row = await queryOne<Record<string, unknown>>(
      `WITH updated AS (
         UPDATE employee_onboarding_tasks
         SET completed = TRUE, completed_at = NOW(), updated_at = NOW(), completion_note = $3
         WHERE id = $1 AND employee_id = $2 AND completed = FALSE
         RETURNING *
       )
       SELECT
         u.id, u.employee_id, u.template_id, u.completed, u.completed_at,
         u.completion_note, u.due_date, u.created_at, u.updated_at, u.assigned_by_user_id,
         tmpl.name AS template_name, tmpl.description AS template_description,
         tmpl.task_type AS template_task_type,
         tmpl.category AS template_category, tmpl.link_url AS template_link_url,
         tmpl.priority AS template_priority,
         CASE
           WHEN assigner.id IS NULL THEN NULL
           WHEN COALESCE(assigner.surname, '') = '' THEN assigner.name
           ELSE assigner.name || ' ' || assigner.surname
         END AS assigned_by_name,
         assigner.avatar_filename AS assigned_by_avatar_filename
       FROM updated u
       JOIN onboarding_templates tmpl ON tmpl.id = u.template_id
       LEFT JOIN users assigner ON assigner.id = u.assigned_by_user_id`,
      [taskId, employeeId, note ?? null],
    );
    if (row) return mapTask(row);
  } else if (companyId) {
    // Admin completing on behalf — verify company ownership via template
    // Use CTE to avoid referencing the update-target alias in FROM-clause JOINs
    row = await queryOne<Record<string, unknown>>(
      `WITH updated AS (
         UPDATE employee_onboarding_tasks
         SET completed = TRUE, completed_at = NOW(), updated_at = NOW(), completion_note = $3
         WHERE id = $1
           AND completed = FALSE
           AND template_id IN (
             SELECT id FROM onboarding_templates WHERE company_id = $2
           )
         RETURNING *
       )
       SELECT
         u.id, u.employee_id, u.template_id, u.completed, u.completed_at,
         u.completion_note, u.due_date, u.created_at, u.updated_at, u.assigned_by_user_id,
         tmpl.name AS template_name, tmpl.description AS template_description,
         tmpl.task_type AS template_task_type,
         tmpl.category AS template_category, tmpl.link_url AS template_link_url,
         tmpl.priority AS template_priority,
         CASE
           WHEN assigner.id IS NULL THEN NULL
           WHEN COALESCE(assigner.surname, '') = '' THEN assigner.name
           ELSE assigner.name || ' ' || assigner.surname
         END AS assigned_by_name,
         assigner.avatar_filename AS assigned_by_avatar_filename
       FROM updated u
       JOIN onboarding_templates tmpl ON tmpl.id = u.template_id
       LEFT JOIN users assigner ON assigner.id = u.assigned_by_user_id`,
      [taskId, companyId, note ?? null],
    );
    if (row) return mapTask(row);
  } else {
    return null;
  }

  return null;
}

export async function uncompleteTask(
  taskId: number,
  companyId: number,
): Promise<OnboardingTask | null> {
  // Join through template to verify company ownership
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE employee_onboarding_tasks t
     SET completed = FALSE, completed_at = NULL, updated_at = NOW()
     FROM onboarding_templates tmpl
     LEFT JOIN users assigner ON assigner.id = t.assigned_by_user_id
     WHERE t.id = $1
       AND t.template_id = tmpl.id
       AND tmpl.company_id = $2
       AND t.completed = TRUE
     RETURNING t.id, t.employee_id, t.template_id, t.completed, t.completed_at,
               t.completion_note, t.due_date, t.created_at, t.updated_at, t.assigned_by_user_id,
               tmpl.name AS template_name, tmpl.description AS template_description,
               tmpl.task_type AS template_task_type,
               tmpl.category AS template_category, tmpl.link_url AS template_link_url,
               tmpl.priority AS template_priority,
               CASE
                 WHEN assigner.id IS NULL THEN NULL
                 WHEN COALESCE(assigner.surname, '') = '' THEN assigner.name
                 ELSE assigner.name || ' ' || assigner.surname
               END AS assigned_by_name,
               assigner.avatar_filename AS assigned_by_avatar_filename`,
    [taskId, companyId],
  );
  return row ? mapTask(row) : null;
}

export async function bulkAssignAll(companyId: number): Promise<{ employees: number; tasks: number }> {
  // Get all active employees with no tasks assigned
  const unassigned = await query<{ id: number }>(
    `SELECT u.id
     FROM users u
     WHERE u.company_id = $1
       AND u.role = 'employee'
       AND u.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM employee_onboarding_tasks t
         JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
         WHERE t.employee_id = u.id AND tmpl.company_id = $1
       )`,
    [companyId],
  );

  let totalTasks = 0;
  for (const emp of unassigned) {
    const count = await assignTasksToEmployee(emp.id, companyId);
    totalTasks += count;
  }

  return { employees: unassigned.length, tasks: totalTasks };
}

export async function getOnboardingStats(companyId: number): Promise<{
  totalEmployees: number;
  notStarted: number;
  inProgress: number;
  complete: number;
  avgPercentage: number;
}> {
  const row = await queryOne<{
    total_employees: string;
    not_started: string;
    in_progress: string;
    complete: string;
    avg_pct: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_employees,
       COUNT(*) FILTER (WHERE total_tasks = 0)::text AS not_started,
       COUNT(*) FILTER (WHERE total_tasks > 0 AND completed_tasks < total_tasks)::text AS in_progress,
       COUNT(*) FILTER (WHERE total_tasks > 0 AND completed_tasks = total_tasks)::text AS complete,
       COALESCE(AVG(CASE WHEN total_tasks > 0 THEN ROUND(completed_tasks * 100.0 / total_tasks) ELSE 0 END), 0)::text AS avg_pct
     FROM (
       SELECT
         u.id,
         COUNT(t.id) AS total_tasks,
         COUNT(t.id) FILTER (WHERE t.completed = TRUE) AS completed_tasks
       FROM users u
       LEFT JOIN employee_onboarding_tasks t ON t.employee_id = u.id
       LEFT JOIN onboarding_templates tmpl ON tmpl.id = t.template_id AND tmpl.company_id = $1
       WHERE u.company_id = $1
         AND u.role = 'employee'
         AND u.status = 'active'
       GROUP BY u.id
     ) sub`,
    [companyId],
  );

  return {
    totalEmployees: parseInt(row?.total_employees ?? '0', 10),
    notStarted:     parseInt(row?.not_started ?? '0', 10),
    inProgress:     parseInt(row?.in_progress ?? '0', 10),
    complete:       parseInt(row?.complete ?? '0', 10),
    avgPercentage:  Math.round(parseFloat(row?.avg_pct ?? '0')),
  };
}

export async function getEmployeesWithPendingTasks(
  companyId: number,
  daysThreshold = 3,
): Promise<{ employeeId: number; pendingCount: number }[]> {
  const rows = await query<{ employee_id: number; pending_count: string }>(
    `SELECT t.employee_id, COUNT(*) AS pending_count
     FROM employee_onboarding_tasks t
     JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
     JOIN users u ON u.id = t.employee_id
     WHERE tmpl.company_id = $1
       AND t.completed = FALSE
       AND t.created_at < NOW() - ($2 || ' days')::INTERVAL
       AND u.status = 'active'
     GROUP BY t.employee_id`,
    [companyId, daysThreshold],
  );
  return rows.map((r) => ({
    employeeId: r.employee_id,
    pendingCount: parseInt(r.pending_count, 10),
  }));
}
