import { Router } from 'express';
import { z } from 'zod';
import {
  addDriverHistory, all, getSetting, logActivity, newId, notify, notifyAdmins, now, one, run, transaction
} from '../db.ts';
import { adminRequired, asyncRoute, auth, authRequired, companyId, fail, pagination } from '../core.ts';
import { saveFile, upload } from '../upload.ts';

export const driverRoutes = Router();

const statuses = ['Novo cadastro', 'Aguardando documentos', 'Documentação incompleta', 'Em análise', 'Aprovado', 'Reprovado', 'Inativo'] as const;
const requiredDocumentDefaults = ['CNH', 'Comprovante de residência'];

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

function expiryAlert(expiry: string | null, days: number): 'expired' | 'soon' | 'ok' | 'none' {
  if (!expiry) return 'none';
  const remaining = (new Date(expiry).getTime() - Date.now()) / 86400000;
  if (remaining < 0) return 'expired';
  if (remaining <= days) return 'soon';
  return 'ok';
}

function formatDriver(row: any, company: string) {
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
    cnhAlert: expiryAlert(row.cnh_expiry ?? null, getSetting<number>(company, 'document_alert_days', 30)),
    photoUrl: row.photo_file_id ? `/api/files/${row.photo_file_id}/download` : null,
    notes: row.notes ?? null,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.author_name ?? null,
    documentCount: Number(row.document_count) || 0,
    pendingDocuments: Number(row.pending_documents) || 0,
    expiringDocuments: Number(row.expiring_documents) || 0
  };
}

function getDriver(company: string, id: string) {
  const alertDays = getSetting<number>(company, 'document_alert_days', 30);
  const cutoff = new Date(Date.now() + alertDays * 86400000).toISOString().slice(0, 10);
  return one<any>(
    `SELECT d.*, u.name AS author_name,
       (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id) AS document_count,
       (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.status = 'pendente') AS pending_documents,
       (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.expiry_date IS NOT NULL AND dd.expiry_date <= ?) AS expiring_documents
      FROM drivers d LEFT JOIN users u ON u.id = d.created_by
      WHERE d.id = ? AND d.company_id = ?`,
    cutoff,
    id,
    company
  );
}

function driverDocuments(company: string, driverId: string) {
  return all<any>(
    `SELECT dd.id AS linkId, dd.type, dd.expiry_date, dd.status, dd.notes, dd.reviewed_at, dd.created_at,
       f.id, f.name, f.mime, f.size
      FROM driver_documents dd JOIN files f ON f.id = dd.file_id
      WHERE dd.company_id = ? AND dd.driver_id = ? ORDER BY dd.created_at DESC`,
    company,
    driverId
  ).map((row) => ({
    ...row,
    expiryAlert: expiryAlert(row.expiry_date ?? null, getSetting<number>(company, 'document_alert_days', 30))
  }));
}

function assertCanApprove(company: string, driver: any): void {
  const required = getSetting<string[]>(company, 'required_driver_documents', requiredDocumentDefaults);
  const documents = driverDocuments(company, driver.id);
  const missing = required.filter((type) => !documents.some((document) => document.type === type));
  if (missing.length) fail(400, `Documentos obrigatórios pendentes: ${missing.join(', ')}.`);
  if (documents.some((document) => document.status !== 'aprovado')) fail(400, 'Revise e aprove todos os documentos antes de aprovar o motorista.');
  if (driver.cnh_expiry && new Date(driver.cnh_expiry).getTime() < Date.now()) fail(400, 'A CNH está vencida.');
}

export function createPendingDriver(company: string, userId: string, input: {
  name: string;
  cpf: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  cnhNumber?: string | null;
  cnhCategory?: string | null;
  cnhExpiry?: string | null;
  notes?: string | null;
}) {
  const cpf = input.cpf.replace(/\D/g, '');
  if (cpf.length !== 11) fail(400, 'CPF deve conter 11 dígitos.');
  const duplicate = one<{ id: string }>('SELECT id FROM drivers WHERE company_id = ? AND cpf = ?', company, cpf);
  if (duplicate) fail(409, 'Já existe motorista com este CPF.');
  const id = newId();
  run(
    `INSERT INTO drivers (
      id, company_id, name, cpf, phone, email, address, city, state, zip,
      cnh_number, cnh_category, cnh_expiry, notes, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, company, input.name.trim(), cpf, clean(input.phone ?? null), clean(input.email ?? null)?.toLowerCase() ?? null,
    clean(input.address ?? null), clean(input.city ?? null), clean(input.state ?? null)?.toUpperCase() ?? null,
    clean(input.zip ?? null), clean(input.cnhNumber ?? null), clean(input.cnhCategory ?? null),
    clean(input.cnhExpiry ?? null), clean(input.notes ?? null), 'Aguardando documentos', userId, now(), now()
  );
  addDriverHistory(company, id, userId, 'Cadastro pendente criado', 'Origem: WhatsApp');
  notifyAdmins(company, 'Cadastro de motorista pendente', `${input.name} • revisar documentos`);
  return id;
}

driverRoutes.get(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const { limit, offset } = pagination(req);
    const conditions = ['d.company_id = ?'];
    const params: any[] = [company];
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
    if (req.query.pendingDocuments === '1') {
      conditions.push("EXISTS (SELECT 1 FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.status = 'pendente')");
    }
    if (req.query.expiring === '1') {
      const alertDays = getSetting<number>(company, 'document_alert_days', 30);
      const cutoff = new Date(Date.now() + alertDays * 86400000).toISOString().slice(0, 10);
      conditions.push('(d.cnh_expiry <= ? OR EXISTS (SELECT 1 FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.expiry_date <= ? AND dd.expiry_date IS NOT NULL))');
      params.push(cutoff, cutoff);
    }
    const where = conditions.join(' AND ');
    const total = one<{ n: number }>(`SELECT COUNT(*) AS n FROM drivers d WHERE ${where}`, ...params)?.n ?? 0;
    const rows = all<any>(
      `SELECT d.*, u.name AS author_name,
         (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id) AS document_count,
         (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.status = 'pendente') AS pending_documents,
         (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.expiry_date IS NOT NULL AND dd.expiry_date <= ?) AS expiring_documents
        FROM drivers d LEFT JOIN users u ON u.id = d.created_by
        WHERE ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
      new Date(Date.now() + getSetting<number>(company, 'document_alert_days', 30) * 86400000).toISOString().slice(0, 10),
      ...params,
      limit,
      offset
    );
    res.json({ items: rows.map((row) => formatDriver(row, company)), total, page: Math.floor(offset / limit) + 1, limit });
  })
);

driverRoutes.get(
  '/:id/history',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const driver = getDriver(company, req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    const history = all<any>(
      `SELECT h.*, u.name AS user_name FROM driver_history h LEFT JOIN users u ON u.id = h.created_by
       WHERE h.company_id = ? AND h.driver_id = ? ORDER BY h.created_at ASC`,
      company, driver.id
    );
    res.json({ history });
  })
);

driverRoutes.post(
  '/:id/photo',
  authRequired,
  upload.single('photo'),
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const driver = getDriver(company, req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    if (!req.file) fail(400, 'Nenhuma imagem enviada.');
    if (!req.file.mimetype.startsWith('image/')) fail(400, 'A foto deve ser uma imagem.');
    const file = saveFile(company, auth(req).id, req.file);
    run('UPDATE drivers SET photo_file_id = ?, updated_at = ? WHERE id = ? AND company_id = ?', file.id, now(), driver.id, company);
    addDriverHistory(company, driver.id, auth(req).id, 'Foto atualizada', file.name);
    res.json({ photoUrl: `/api/files/${file.id}/download` });
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
    const body = z.object({
      type: z.string().min(1).max(80),
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().max(300).optional()
    }).parse(req.body);
    const file = saveFile(company, auth(req).id, req.file);
    run(
      'INSERT INTO driver_documents (id, company_id, driver_id, file_id, type, expiry_date, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(), company, driver.id, file.id, body.type.trim(), body.expiryDate ?? null, 'pendente', clean(body.notes), now()
    );
    addDriverHistory(company, driver.id, auth(req).id, 'Documento adicionado', `${body.type}: ${file.name}`);
    notifyAdmins(company, 'Documento para revisão', `${driver.name} • ${body.type}`);
    res.status(201).json({ file });
  })
);

driverRoutes.patch(
  '/:id/documents/:documentId/review',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const driver = getDriver(company, req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    const body = z.object({
      status: z.enum(['aprovado', 'reprovado']),
      notes: z.string().max(300).optional()
    }).parse(req.body);
    const document = one<{ id: string; type: string }>(
      'SELECT id, type FROM driver_documents WHERE id = ? AND company_id = ? AND driver_id = ?',
      req.params.documentId, company, driver.id
    );
    if (!document) fail(404, 'Documento não encontrado.');
    run(
      'UPDATE driver_documents SET status = ?, notes = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?',
      body.status, clean(body.notes), now(), auth(req).id, document.id
    );
    addDriverHistory(company, driver.id, auth(req).id, 'Documento revisado', `${document.type}: ${body.status}`);
    res.json({ ok: true });
  })
);

driverRoutes.get(
  '/:id/documents',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const driver = getDriver(company, req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    res.json({ documents: driverDocuments(company, driver.id) });
  })
);

driverRoutes.get(
  '/:id',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const driver = getDriver(company, req.params.id);
    if (!driver) fail(404, 'Motorista não encontrado.');
    res.json({
      driver: formatDriver(driver, company),
      documents: driverDocuments(company, driver.id),
      history: all<any>(
        `SELECT h.*, u.name AS user_name FROM driver_history h LEFT JOIN users u ON u.id = h.created_by
         WHERE h.company_id = ? AND h.driver_id = ? ORDER BY h.created_at ASC`,
        company, driver.id
      )
    });
  })
);

driverRoutes.post(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const id = createPendingDriver(company, auth(req).id, createSchema.parse(req.body));
    const status = req.body.status ?? 'Novo cadastro';
    if (status !== 'Aguardando documentos') run('UPDATE drivers SET status = ? WHERE id = ?', status, id);
    logActivity(company, auth(req).id, 'driver_created', 'driver', id, { name: req.body.name });
    res.status(201).json({ driver: formatDriver(getDriver(company, id), company) });
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
    if (input.status === 'Aprovado') assertCanApprove(company, driver);
    const mapping: Record<string, string> = {
      name: 'name', cpf: 'cpf', birthDate: 'birth_date', phone: 'phone', email: 'email',
      address: 'address', city: 'city', state: 'state', zip: 'zip', cnhNumber: 'cnh_number',
      cnhCategory: 'cnh_category', cnhExpiry: 'cnh_expiry', notes: 'notes', status: 'status'
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
    logActivity(company, auth(req).id, 'driver_updated', 'driver', driver.id, { status: input.status ?? null });
    res.json({ driver: formatDriver(getDriver(company, driver.id), company) });
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
    const fileIds = all<{ file_id: string }>(
      'SELECT file_id FROM driver_documents WHERE company_id = ? AND driver_id = ?',
      company, driver.id
    ).map((row) => row.file_id);
    if (driver.photo_file_id) fileIds.push(driver.photo_file_id);
    transaction(() => {
      run('DELETE FROM drivers WHERE id = ? AND company_id = ?', driver.id, company);
      for (const fileId of fileIds) run('DELETE FROM files WHERE id = ?', fileId);
    });
    logActivity(company, auth(req).id, 'driver_deleted', 'driver', driver.id, { name: driver.name });
    res.json({ ok: true });
  })
);
