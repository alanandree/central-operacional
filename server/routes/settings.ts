import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { adminRequired, asyncRoute, auth, authRequired, companyId, fail, hashToken } from '../core.ts';
import { all, getSetting, logActivity, newId, notifyAdmins, now, one, run, setSetting } from '../db.ts';

export const settingsRoutes = Router();

settingsRoutes.get(
  '/categories',
  authRequired,
  asyncRoute(async (req, res) => {
    const categories = all<any>(
      'SELECT id, name, sla_hours, active, created_at FROM occurrence_categories WHERE company_id = ? ORDER BY name ASC',
      companyId(req)
    ).map((row) => ({ ...row, active: Boolean(row.active) }));
    res.json({ categories });
  })
);

settingsRoutes.post(
  '/categories',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().min(2), slaHours: z.number().int().min(1).max(720).default(48) }).parse(req.body);
    const id = newId();
    try {
      run(
        'INSERT INTO occurrence_categories (id, company_id, name, sla_hours, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        id,
        companyId(req),
        body.name.trim(),
        body.slaHours,
        now()
      );
    } catch {
      fail(409, 'Já existe categoria com este nome.');
    }
    logActivity(companyId(req), auth(req).id, 'category_created', 'category', id, body);
    res.status(201).json({ category: { id, name: body.name.trim(), slaHours: body.slaHours, active: true } });
  })
);

settingsRoutes.patch(
  '/categories/:id',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({ name: z.string().min(2).optional(), slaHours: z.number().int().min(1).max(720).optional(), active: z.boolean().optional() })
      .parse(req.body);
    const category = one<{ id: string }>(
      'SELECT id FROM occurrence_categories WHERE id = ? AND company_id = ?',
      req.params.id,
      companyId(req)
    );
    if (!category) fail(404, 'Categoria não encontrada.');
    const fields: string[] = [];
    const values: any[] = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(body.name.trim());
    }
    if (body.slaHours !== undefined) {
      fields.push('sla_hours = ?');
      values.push(body.slaHours);
    }
    if (body.active !== undefined) {
      fields.push('active = ?');
      values.push(body.active ? 1 : 0);
    }
    if (fields.length === 0) fail(400, 'Nenhum campo informado.');
    run(`UPDATE occurrence_categories SET ${fields.join(', ')} WHERE id = ?`, ...values, category.id);
    logActivity(companyId(req), auth(req).id, 'category_updated', 'category', category.id, body);
    res.json({ ok: true });
  })
);

settingsRoutes.delete(
  '/categories/:id',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const category = one<{ id: string }>(
      'SELECT id FROM occurrence_categories WHERE id = ? AND company_id = ?',
      req.params.id,
      companyId(req)
    );
    if (!category) fail(404, 'Categoria não encontrada.');
    run('DELETE FROM occurrence_categories WHERE id = ?', category.id);
    logActivity(companyId(req), auth(req).id, 'category_deleted', 'category', category.id);
    res.json({ ok: true });
  })
);

settingsRoutes.get(
  '/settings',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const companyRow = one<{ name: string }>('SELECT name FROM companies WHERE id = ?', company);
    res.json({
      company: { name: companyRow?.name ?? 'Empresa' },
      slaDefaultHours: getSetting(company, 'sla_default_hours', 48),
      businessHours: getSetting(company, 'business_hours', { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] }),
      notificationOffsets: getSetting(company, 'notification_offsets', [24, 12, 2, 0]),
      whatsappGroupSupport: getSetting(company, 'whatsapp_group_support', 'unknown'),
      holidays: getSetting<string[]>(company, 'holidays', []),
      slaPriorityFactor: getSetting<Record<string, number>>(company, 'sla_priority_factor', { Baixa: 1.5, Normal: 1, Alta: 0.5, Urgente: 0.25 }),
      slaPauseStatuses: getSetting<string[]>(company, 'sla_pause_statuses', ['Aguardando cliente', 'Aguardando transportadora', 'Aguardando motorista']),
      documentAlertDays: getSetting<number>(company, 'document_alert_days', 30),
      retentionDays: getSetting<number>(company, 'retention_days', 365)
    });
  })
);

settingsRoutes.patch(
  '/settings',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        companyName: z.string().min(2).optional(),
        slaDefaultHours: z.number().int().min(1).max(720).optional(),
        businessHours: z
          .object({
            start: z.string().regex(/^\d{2}:\d{2}$/),
            end: z.string().regex(/^\d{2}:\d{2}$/),
            days: z.array(z.number().int().min(0).max(6)).min(1)
          })
          .optional(),
        holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
        slaPriorityFactor: z
          .object({
            Baixa: z.number().positive(),
            Normal: z.number().positive(),
            Alta: z.number().positive(),
            Urgente: z.number().positive()
          })
          .optional(),
        slaPauseStatuses: z.array(z.string().min(2)).optional(),
        notificationOffsets: z.array(z.number().int().min(0).max(168)).optional(),
        whatsappGroupSupport: z.enum(['unknown', 'yes', 'no']).optional(),
        documentAlertDays: z.number().int().min(1).max(365).optional(),
        retentionDays: z.number().int().min(30).max(3650).optional()
      })
      .parse(req.body);
    if (body.businessHours) {
      if (body.businessHours.start >= body.businessHours.end) fail(400, 'O horário de abertura deve ser anterior ao fechamento.');
      if (new Set(body.businessHours.days).size !== body.businessHours.days.length) fail(400, 'Há dias úteis duplicados.');
    }
    const company = companyId(req);
    if (body.companyName) run('UPDATE companies SET name = ? WHERE id = ?', body.companyName.trim(), company);
    if (body.slaDefaultHours !== undefined) setSetting(company, 'sla_default_hours', body.slaDefaultHours);
    if (body.businessHours) setSetting(company, 'business_hours', body.businessHours);
    if (body.holidays) setSetting(company, 'holidays', [...new Set(body.holidays)].sort());
    if (body.slaPriorityFactor) setSetting(company, 'sla_priority_factor', body.slaPriorityFactor);
    if (body.slaPauseStatuses) setSetting(company, 'sla_pause_statuses', [...new Set(body.slaPauseStatuses)]);
    if (body.notificationOffsets) setSetting(company, 'notification_offsets', body.notificationOffsets);
    if (body.whatsappGroupSupport) setSetting(company, 'whatsapp_group_support', body.whatsappGroupSupport);
    if (body.documentAlertDays !== undefined) setSetting(company, 'document_alert_days', body.documentAlertDays);
    if (body.retentionDays !== undefined) setSetting(company, 'retention_days', body.retentionDays);
    logActivity(company, auth(req).id, 'settings_updated', 'settings', company, body);
    res.json({ ok: true });
  })
);

settingsRoutes.get(
  '/users',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const users = all<any>(
      'SELECT id, name, email, role, avatar_url, created_at, last_login_at FROM users WHERE company_id = ? ORDER BY created_at ASC',
      companyId(req)
    ).map((row) => ({
      ...row,
      avatarUrl: row.avatar_url ?? null,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at
    }));
    res.json({ users });
  })
);

settingsRoutes.post(
  '/users',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
        role: z.enum(['admin', 'employee']).default('employee')
      })
      .parse(req.body);
    const id = newId();
    try {
      run(
        'INSERT INTO users (id, company_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id,
        companyId(req),
        body.name.trim(),
        body.email.trim().toLowerCase(),
        bcrypt.hashSync(body.password, 10),
        body.role,
        now()
      );
    } catch {
      fail(409, 'Este e-mail já está em uso.');
    }
    logActivity(companyId(req), auth(req).id, 'user_created', 'user', id, { email: body.email, role: body.role });
    res.status(201).json({ user: { id, name: body.name, email: body.email, role: body.role } });
  })
);

settingsRoutes.patch(
  '/users/:id',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2).optional(),
        email: z.string().email().optional(),
        role: z.enum(['admin', 'employee']).optional(),
        password: z.string().min(8).optional()
      })
      .parse(req.body);
    const user = one<{ id: string }>('SELECT id FROM users WHERE id = ? AND company_id = ?', req.params.id, companyId(req));
    if (!user) fail(404, 'Usuário não encontrado.');
    const fields: string[] = [];
    const values: any[] = [];
    if (body.name) {
      fields.push('name = ?');
      values.push(body.name.trim());
    }
    if (body.email) {
      fields.push('email = ?');
      values.push(body.email.trim().toLowerCase());
    }
    if (body.role) {
      fields.push('role = ?');
      values.push(body.role);
    }
    if (body.password) {
      fields.push('password_hash = ?');
      values.push(bcrypt.hashSync(body.password, 10));
    }
    if (fields.length === 0) fail(400, 'Nenhum campo informado.');
    try {
      run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...values, user.id);
      if (body.password) {
        const header = req.header('authorization') || '';
        const currentHash = hashToken(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
        run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?', now(), user.id, currentHash);
      }
    } catch {
      fail(409, 'Este e-mail já está em uso.');
    }
    logActivity(companyId(req), auth(req).id, 'user_updated', 'user', user.id, body);
    res.json({ ok: true });
  })
);

settingsRoutes.delete(
  '/users/:id',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    if (req.params.id === auth(req).id) fail(400, 'Você não pode excluir seu próprio usuário.');
    const user = one<{ id: string }>('SELECT id FROM users WHERE id = ? AND company_id = ?', req.params.id, companyId(req));
    if (!user) fail(404, 'Usuário não encontrado.');
    run('DELETE FROM users WHERE id = ?', user.id);
    logActivity(companyId(req), auth(req).id, 'user_deleted', 'user', user.id);
    res.json({ ok: true });
  })
);

settingsRoutes.get(
  '/privacy/export',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const user = one<any>(
      'SELECT id, name, email, role, avatar_url, created_at, last_login_at FROM users WHERE id = ? AND company_id = ?',
      auth(req).id,
      company
    );
    if (!user) fail(404, 'Usuário não encontrado.');
    res.json({
      generatedAt: now(),
      user: { ...user, avatarUrl: user.avatar_url ?? null },
      occurrences: all<any>('SELECT id, number, customer_name, description, received_at, created_at FROM occurrences WHERE company_id = ? AND created_by = ?', company, user.id),
      drivers: all<any>('SELECT id, name, cpf, phone, email, created_at FROM drivers WHERE company_id = ? AND created_by = ?', company, user.id),
      activity: all<any>('SELECT action, entity, entity_id, created_at FROM activity_logs WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 500', company, user.id)
    });
  })
);

settingsRoutes.get(
  '/privacy-requests',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const requests = all<any>(
      'SELECT id, user_id, type, status, subject_name, created_at, completed_at FROM privacy_requests WHERE company_id = ? ORDER BY created_at DESC',
      companyId(req)
    );
    res.json({ requests });
  })
);

settingsRoutes.post(
  '/privacy-requests',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({
      type: z.enum(['exportacao', 'exclusao']),
      subjectName: z.string().min(2),
      details: z.string().max(500).optional()
    }).parse(req.body);
    const company = companyId(req);
    const id = newId();
    run(
      'INSERT INTO privacy_requests (id, company_id, user_id, type, status, subject_name, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, company, auth(req).id, body.type, 'pendente', body.subjectName.trim(), clean(body.details), now()
    );
    notifyAdmins(company, 'Solicitação de LGPD', `${body.type === 'exportacao' ? 'Exportação' : 'Exclusão'} de dados: ${body.subjectName}`);
    res.status(201).json({ id, status: 'pendente' });
  })
);

settingsRoutes.patch(
  '/privacy-requests/:id/complete',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const requestRow = one<{ id: string }>('SELECT id FROM privacy_requests WHERE id = ? AND company_id = ?', req.params.id, companyId(req));
    if (!requestRow) fail(404, 'Solicitação não encontrada.');
    run('UPDATE privacy_requests SET status = ?, completed_at = ? WHERE id = ?', 'concluida', now(), requestRow.id);
    logActivity(companyId(req), auth(req).id, 'privacy_request_completed', 'privacy', requestRow.id);
    res.json({ ok: true });
  })
);

function clean(value: string | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}
