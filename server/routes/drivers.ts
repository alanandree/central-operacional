import { Router } from 'express';
import { z } from 'zod';
import { addDriverHistory, all, logActivity, newId, notify, now, one, run } from '../db.ts';
import { adminRequired, asyncRoute, auth, authRequired, companyId, fail, pagination } from '../core.ts';
import { saveFile, upload } from '../upload.ts';

export const driverRoutes = Router();

const statuses = ['Novo cadastro', 'Aguardando documentos', 'Documentação incompleta', 'Em análise', 'Aprovado', 'Reprovado', 'Inativo'] as const;

const createSchema = z.object({
  name: z.string().min(2),
  cpf: z.string().min(11).max(20),
  birthDate: z.string().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(2).nullable().optional(),
  zip: z.string().max(12).nullable().optional(),
  cnhNumber: z.string().max(30).nullable().optional(),
  cnhCategory: z.string().max(10).nullable().optional(),
  cnhExpiry: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(statuses).default('Novo cadastro')
});

const updateSchema = createSchema.partial();

function clean(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

function cnhAlert(expiry: string | null): 'expired' | 'soon' | 'ok' | 'none' {
  if (!expiry) return 'none';
  const days = (new Date(expiry).getTime() - Date.now()) / 86400000;
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}

function formatDriver(row: any) {
  return {
    id: row.id,
    name: row.name,
    cpf: row.cpf,
    birthDate: row.birth_date ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zip: row.zip ?? null,
    cnhNumber: row.cnh_number ?? null,
    cnhCategory: row.cnh_category ?? null,
    cnhExpiry: row.cnh_expiry ?? null,
    cnhAlert: cnhAlert(row.cnh_expiry ?? null),
    notes: row.notes ?? null,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.author_name ?? null,
    documentCount: row.document_count ?? 0
  };
}

function getDriver(company: string, id: string) {
  return one<any>(
    `SELECT d.*, u.name AS author_name,
      (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id) AS document_count
     FROM drivers d LEFT JOIN users u ON u.id = d.created_by
     WHERE d.id = ? AND d.company_id = ?`,
    id,
    company
  );
}

driverRoutes.get(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const { limit, offset } = pagination(req);
    const conditions = ['d.company_id = ?'];
    const params: any[] = [companyId(req)];
    const search = String(req.query.search || '').trim();
    if (search) {
      conditions.push('(d.name LIKE ? OR d.cpf LIKE ? OR d.phone LIKE ? OR d.cnh_number LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    if (req.query.status) {
      conditions.push('d.status = ?');
      params.push(String(req.query.status));
    }
    const where = conditions.join(' AND ');
    const total = one<{ n: number }>(`SELECT COUNT(*) AS n FROM drivers d WHERE ${where}`, ...params)?.n ?? 0;
    const rows = all<any>(
      `SELECT d.*, u.name AS author_name,
        (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id) AS document_count
       FROM drivers d LEFT JOIN users u ON u.id = d.created_by
       WHERE ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    );
    res.json({ items: rows.map(formatDriver), total, page: Math.floor(offset / limit) + 1, limit });
  })
);

driverRoutes.get(
  '/:id/history',
  authRequired,
  asyncRoute(async (req, res) => {
    const driver = getDriver(companyId(req), req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    const history = all<any>(
      `SELECT h.*, u.name AS user_name FROM driver_history h JOIN users u ON u.id = h.created_by
       WHERE h.driver_id = ? ORDER BY h.created_at ASC`,
      driver.id
    );
    res.json({ history });
  })
);

driverRoutes.post(
  '/:id/documents',
  authRequired,
  upload.single('file'),
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const driver = getDriver(company, req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    if (!req.file) fail(400, 'Nenhum arquivo enviado.');
    const body = z.object({ type: z.string().min(1).max(80) }).parse(req.body);
    const file = saveFile(company, auth(req).id, req.file);
    run(
      'INSERT INTO driver_documents (id, company_id, driver_id, file_id, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      company,
      driver.id,
      file.id,
      body.type,
      now()
    );
    addDriverHistory(company, driver.id, auth(req).id, 'Documento adicionado', `${body.type}: ${file.name}`);
    res.status(201).json({ file });
  })
);

driverRoutes.get(
  '/:id',
  authRequired,
  asyncRoute(async (req, res) => {
    const driver = getDriver(companyId(req), req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    const documents = all<any>(
      `SELECT dd.id AS link_id, dd.type, dd.created_at, f.id, f.name, f.mime, f.size
       FROM driver_documents dd JOIN files f ON f.id = dd.file_id
       WHERE dd.driver_id = ? ORDER BY dd.created_at DESC`,
      driver.id
    );
    const history = all<any>(
      `SELECT h.*, u.name AS user_name FROM driver_history h JOIN users u ON u.id = h.created_by
       WHERE h.driver_id = ? ORDER BY h.created_at ASC`,
      driver.id
    );
    res.json({ driver: formatDriver(driver), documents, history });
  })
);

driverRoutes.post(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const input = createSchema.parse(req.body);
    const company = companyId(req);
    const cpf = input.cpf.replace(/\D/g, '');
    if (cpf.length !== 11) fail(400, 'CPF deve conter 11 dígitos.');
    const duplicate = one<{ id: string }>('SELECT id FROM drivers WHERE company_id = ? AND cpf = ?', company, cpf);
    if (duplicate) fail(409, 'Já existe motorista com este CPF.');
    const id = newId();
    try {
      run(
        `INSERT INTO drivers (
          id, company_id, name, cpf, birth_date, phone, email, address, city, state, zip,
          cnh_number, cnh_category, cnh_expiry, notes, status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        company,
        input.name.trim(),
        cpf,
        clean(input.birthDate),
        clean(input.phone),
        clean(input.email)?.toLowerCase() ?? null,
        clean(input.address),
        clean(input.city),
        clean(input.state)?.toUpperCase() ?? null,
        clean(input.zip),
        clean(input.cnhNumber),
        clean(input.cnhCategory),
        clean(input.cnhExpiry),
        clean(input.notes),
        input.status,
        auth(req).id,
        now(),
        now()
      );
    } catch {
      fail(409, 'Já existe motorista com este CPF.');
    }
    addDriverHistory(company, id, auth(req).id, 'Cadastro criado', `Status: ${input.status}`);
    logActivity(company, auth(req).id, 'driver_created', 'driver', id, { name: input.name });
    notify(company, auth(req).id, 'driver', 'Motorista cadastrado', `${input.name} • ${input.status}`);
    res.status(201).json({ driver: formatDriver(getDriver(company, id)) });
  })
);

driverRoutes.patch(
  '/:id',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const driver = getDriver(company, req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    const input = updateSchema.parse(req.body);
    const mapping: Record<string, string> = {
      name: 'name',
      cpf: 'cpf',
      birthDate: 'birth_date',
      phone: 'phone',
      email: 'email',
      address: 'address',
      city: 'city',
      state: 'state',
      zip: 'zip',
      cnhNumber: 'cnh_number',
      cnhCategory: 'cnh_category',
      cnhExpiry: 'cnh_expiry',
      notes: 'notes',
      status: 'status'
    };
    const fields: string[] = [];
    const values: any[] = [];
    const changes: string[] = [];
    for (const [key, column] of Object.entries(mapping)) {
      if (!(key in input)) continue;
      let value: any = (input as any)[key];
      if (typeof value === 'string') value = value.trim() || null;
      if (key === 'cpf' && value) value = value.replace(/\D/g, '');
      if (key === 'email' && value) value = value.toLowerCase();
      if (key === 'state' && value) value = value.toUpperCase();
      fields.push(`${column} = ?`);
      values.push(value);
      changes.push(`${key}: ${String(value ?? '—')}`);
    }
    if (fields.length === 0) fail(400, 'Nenhum campo informado.');
    fields.push('updated_at = ?');
    values.push(now(), driver.id, company);
    try {
      run(`UPDATE drivers SET ${fields.join(', ')} WHERE id = ? AND company_id = ?`, ...values);
    } catch {
      fail(409, 'Já existe motorista com este CPF.');
    }
    if (changes.length) addDriverHistory(company, driver.id, auth(req).id, 'Cadastro atualizado', changes.join(' | '));
    if (input.status && input.status !== driver.status) {
      notify(company, auth(req).id, 'driver', 'Status de motorista alterado', `${driver.name}: ${input.status}`);
    }
    logActivity(company, auth(req).id, 'driver_updated', 'driver', driver.id, input);
    res.json({ driver: formatDriver(getDriver(company, driver.id)) });
  })
);

driverRoutes.delete(
  '/:id',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const driver = getDriver(company, req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    run('DELETE FROM drivers WHERE id = ? AND company_id = ?', driver.id, company);
    logActivity(company, auth(req).id, 'driver_deleted', 'driver', driver.id, { name: driver.name });
    res.json({ ok: true });
  })
);
