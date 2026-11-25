import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { adminRequired, asyncRoute, auth, authRequired, companyId, fail } from '../core.ts';
import { all, getSetting, logActivity, newId, now, one, run, setSetting } from '../db.ts';

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
      whatsappGroupSupport: getSetting(company, 'whatsapp_group_support', 'unknown')
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
            days: z.array(z.number().int().min(0).max(6))
          })
          .optional(),
        notificationOffsets: z.array(z.number().int().min(0).max(168)).optional(),
        whatsappGroupSupport: z.enum(['unknown', 'yes', 'no']).optional()
      })
      .parse(req.body);
    const company = companyId(req);
    if (body.companyName) run('UPDATE companies SET name = ? WHERE id = ?', body.companyName.trim(), company);
    if (body.slaDefaultHours !== undefined) setSetting(company, 'sla_default_hours', body.slaDefaultHours);
    if (body.businessHours) setSetting(company, 'business_hours', body.businessHours);
    if (body.notificationOffsets) setSetting(company, 'notification_offsets', body.notificationOffsets);
    if (body.whatsappGroupSupport) setSetting(company, 'whatsapp_group_support', body.whatsappGroupSupport);
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
