import { Router } from 'express';
import { z } from 'zod';
import { addOccurrenceHistory, all, getSetting, logActivity, newId, nextOccurrenceNumber, notify, now, one, run } from '../db.ts';
import { adminRequired, asyncRoute, auth, authRequired, companyId, fail, pagination } from '../core.ts';
import { saveFile, upload } from '../upload.ts';

export const occurrenceRoutes = Router();

const statuses = ['Nova ocorrência', 'Em análise', 'Em andamento', 'Aguardando retorno', 'Aguardando cliente', 'Aguardando transportadora', 'Resolvida', 'Encerrada'] as const;
const priorities = ['Baixa', 'Normal', 'Alta', 'Urgente'] as const;

const createSchema = z.object({
  customerName: z.string().min(2),
  customerPhone: z.string().max(40).optional(),
  orderCode: z.string().max(80).optional(),
  trackingCode: z.string().max(80).optional(),
  recipientName: z.string().max(160).optional(),
  categoryId: z.string().nullable().optional(),
  description: z.string().min(3),
  receivedAt: z.string().optional(),
  origin: z.string().max(80).optional(),
  responsible: z.string().max(160).optional(),
  priority: z.enum(priorities).default('Normal'),
  dueAt: z.string().nullable().optional(),
  status: z.enum(statuses).default('Nova ocorrência')
});

const updateSchema = createSchema.partial();

function clean(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

function categorySla(companyIdValue: string, categoryIdValue: string | null | undefined): number {
  if (categoryIdValue) {
    const category = one<{ sla_hours: number }>(
      'SELECT sla_hours FROM occurrence_categories WHERE id = ? AND company_id = ?',
      categoryIdValue,
      companyIdValue
    );
    if (category) return category.sla_hours;
  }
  return getSetting<number>(companyIdValue, 'sla_default_hours', 48);
}

function dueFromNow(hours: number, receivedAt: string): string {
  return new Date(new Date(receivedAt).getTime() + hours * 3600000).toISOString();
}

function formatOccurrence(row: any) {
  const closed = row.status === 'Resolvida' || row.status === 'Encerrada';
  const overdue = Boolean(row.due_at && !closed && new Date(row.due_at).getTime() < Date.now());
  return {
    id: row.id,
    number: row.number,
    code: `OC-${String(row.number).padStart(5, '0')}`,
    customerName: row.customer_name,
    customerPhone: row.customer_phone ?? null,
    orderCode: row.order_code ?? null,
    trackingCode: row.tracking_code ?? null,
    recipientName: row.recipient_name ?? null,
    categoryId: row.category_id ?? null,
    categoryName: row.category_name ?? null,
    description: row.description,
    receivedAt: row.received_at,
    origin: row.origin ?? 'Manual',
    responsible: row.responsible ?? null,
    priority: row.priority,
    dueAt: row.due_at ?? null,
    status: row.status,
    closedAt: row.closed_at ?? null,
    overdue,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.author_name ?? null
  };
}

function getOccurrence(companyIdValue: string, id: string) {
  return one<any>(
    `SELECT o.*, c.name AS category_name, u.name AS author_name
     FROM occurrences o
     LEFT JOIN occurrence_categories c ON c.id = o.category_id
     LEFT JOIN users u ON u.id = o.created_by
     WHERE o.id = ? AND o.company_id = ?`,
    id,
    companyIdValue
  );
}

function notifyCompany(companyIdValue: string, title: string, body: string, excludeUserId?: string): void {
  const users = all<{ id: string }>('SELECT id FROM users WHERE company_id = ?', companyIdValue);
  for (const user of users) {
    if (user.id === excludeUserId) continue;
    notify(companyIdValue, user.id, 'occurrence', title, body);
  }
}

occurrenceRoutes.get(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const { limit, offset } = pagination(req);
    const conditions = ['o.company_id = ?'];
    const params: any[] = [companyId(req)];

    const search = String(req.query.search || '').trim();
    if (search) {
      conditions.push('(o.customer_name LIKE ? OR o.order_code LIKE ? OR o.tracking_code LIKE ? OR o.description LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    if (req.query.categoryId) {
      conditions.push('o.category_id = ?');
      params.push(String(req.query.categoryId));
    }
    if (req.query.status) {
      conditions.push('o.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.priority) {
      conditions.push('o.priority = ?');
      params.push(String(req.query.priority));
    }
    if (req.query.from) {
      conditions.push('o.received_at >= ?');
      params.push(new Date(String(req.query.from)).toISOString());
    }
    if (req.query.to) {
      conditions.push('o.received_at <= ?');
      params.push(new Date(String(req.query.to)).toISOString());
    }

    const sortMap: Record<string, string> = {
      created: 'o.created_at DESC',
      recent: 'o.received_at DESC',
      due: 'o.due_at IS NULL, o.due_at ASC',
      priority: "CASE o.priority WHEN 'Urgente' THEN 0 WHEN 'Alta' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, o.created_at DESC"
    };
    const orderBy = sortMap[String(req.query.sort || 'created')] ?? sortMap.created;
    const where = conditions.join(' AND ');
    const total = one<{ n: number }>(`SELECT COUNT(*) AS n FROM occurrences o WHERE ${where}`, ...params)?.n ?? 0;
    const rows = all<any>(
      `SELECT o.*, c.name AS category_name, u.name AS author_name
       FROM occurrences o
       LEFT JOIN occurrence_categories c ON c.id = o.category_id
       LEFT JOIN users u ON u.id = o.created_by
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    );
    res.json({ items: rows.map(formatOccurrence), total, page: Math.floor(offset / limit) + 1, limit });
  })
);

occurrenceRoutes.get(
  '/:id/history',
  authRequired,
  asyncRoute(async (req, res) => {
    const occurrence = getOccurrence(companyId(req), req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    const history = all<any>(
      `SELECT h.*, u.name AS user_name FROM occurrence_history h
       JOIN users u ON u.id = h.created_by
       WHERE h.company_id = ? AND h.occurrence_id = ? ORDER BY h.created_at ASC`,
      companyId(req),
      req.params.id
    );
    res.json({ history });
  })
);

occurrenceRoutes.get(
  '/:id/messages',
  authRequired,
  asyncRoute(async (req, res) => {
    const occurrence = getOccurrence(companyId(req), req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    const messages = all<any>(
      'SELECT id, direction, from_number, to_number, body, occurred_at, processed FROM whatsapp_messages WHERE company_id = ? AND occurrence_id = ? ORDER BY occurred_at DESC',
      companyId(req),
      req.params.id
    );
    res.json({ messages });
  })
);

occurrenceRoutes.post(
  '/:id/notes',
  authRequired,
  asyncRoute(async (req, res) => {
    const occurrence = getOccurrence(companyId(req), req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    const body = z.object({ note: z.string().min(1) }).parse(req.body);
    addOccurrenceHistory(companyId(req), occurrence.id, auth(req).id, 'Observação interna', body.note);
    logActivity(companyId(req), auth(req).id, 'note_added', 'occurrence', occurrence.id, { note: body.note });
    res.json({ ok: true });
  })
);

occurrenceRoutes.post(
  '/:id/attachments',
  authRequired,
  upload.single('file'),
  asyncRoute(async (req, res) => {
    const occurrence = getOccurrence(companyId(req), req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    if (!req.file) fail(400, 'Nenhum arquivo enviado.');
    const file = saveFile(companyId(req), auth(req).id, req.file);
    run(
      'INSERT INTO occurrence_attachments (id, company_id, occurrence_id, file_id, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      companyId(req),
      occurrence.id,
      file.id,
      now()
    );
    addOccurrenceHistory(companyId(req), occurrence.id, auth(req).id, 'Anexo adicionado', file.name);
    res.status(201).json({ file });
  })
);

occurrenceRoutes.get(
  '/:id/attachments',
  authRequired,
  asyncRoute(async (req, res) => {
    const occurrence = getOccurrence(companyId(req), req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    const files = all<any>(
      `SELECT f.id, f.name, f.mime, f.size, a.created_at FROM occurrence_attachments a
       JOIN files f ON f.id = a.file_id WHERE a.company_id = ? AND a.occurrence_id = ? ORDER BY a.created_at DESC`,
      companyId(req),
      req.params.id
    );
    res.json({ files });
  })
);

occurrenceRoutes.get(
  '/:id',
  authRequired,
  asyncRoute(async (req, res) => {
    const occurrence = getOccurrence(companyId(req), req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    const history = all<any>(
      `SELECT h.*, u.name AS user_name FROM occurrence_history h
       JOIN users u ON u.id = h.created_by WHERE h.occurrence_id = ? ORDER BY h.created_at ASC`,
      occurrence.id
    );
    const attachments = all<any>(
      `SELECT f.id, f.name, f.mime, f.size, a.created_at FROM occurrence_attachments a
       JOIN files f ON f.id = a.file_id WHERE a.occurrence_id = ? ORDER BY a.created_at DESC`,
      occurrence.id
    );
    const messages = all<any>(
      'SELECT id, direction, from_number, body, occurred_at, processed FROM whatsapp_messages WHERE occurrence_id = ? ORDER BY occurred_at DESC',
      occurrence.id
    );
    res.json({ occurrence: formatOccurrence(occurrence), history, attachments, messages });
  })
);

occurrenceRoutes.post(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const input = createSchema.parse(req.body);
    const company = companyId(req);
    const receivedAt = input.receivedAt ? new Date(input.receivedAt).toISOString() : now();
    const dueAt = input.dueAt === undefined ? dueFromNow(categorySla(company, input.categoryId), receivedAt) : clean(input.dueAt);
    const id = newId();
    const number = nextOccurrenceNumber(company);
    run(
      `INSERT INTO occurrences (
        id, company_id, number, customer_name, customer_phone, order_code, tracking_code, recipient_name,
        category_id, description, received_at, origin, responsible, priority, due_at, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      company,
      number,
      input.customerName.trim(),
      clean(input.customerPhone),
      clean(input.orderCode),
      clean(input.trackingCode),
      clean(input.recipientName),
      clean(input.categoryId),
      input.description.trim(),
      receivedAt,
      input.origin?.trim() || 'Manual',
      clean(input.responsible),
      input.priority,
      dueAt,
      input.status,
      auth(req).id,
      now(),
      now()
    );
    addOccurrenceHistory(company, id, auth(req).id, 'Ocorrência recebida', `Origem: ${input.origin?.trim() || 'Manual'}`);
    addOccurrenceHistory(company, id, auth(req).id, 'Ocorrência registrada', `Prioridade: ${input.priority}`);
    logActivity(company, auth(req).id, 'occurrence_created', 'occurrence', id, { code: `OC-${number}` });
    notifyCompany(company, 'Nova ocorrência registrada', `${input.customerName} • ${input.description.slice(0, 80)}`, auth(req).id);
    res.status(201).json({ occurrence: formatOccurrence(getOccurrence(company, id)) });
  })
);

occurrenceRoutes.patch(
  '/:id',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const occurrence = getOccurrence(company, req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    const input = updateSchema.parse(req.body);
    const mapping: Record<string, string> = {
      customerName: 'customer_name',
      customerPhone: 'customer_phone',
      orderCode: 'order_code',
      trackingCode: 'tracking_code',
      recipientName: 'recipient_name',
      categoryId: 'category_id',
      description: 'description',
      receivedAt: 'received_at',
      origin: 'origin',
      responsible: 'responsible',
      priority: 'priority',
      dueAt: 'due_at',
      status: 'status'
    };
    const fields: string[] = [];
    const values: any[] = [];
    const changes: string[] = [];
    for (const [key, column] of Object.entries(mapping)) {
      if (!(key in input)) continue;
      let value: any = (input as any)[key];
      if (typeof value === 'string') value = value.trim() || null;
      if (key === 'receivedAt' && value) value = new Date(value).toISOString();
      fields.push(`${column} = ?`);
      values.push(value);
      changes.push(`${key}: ${String(value ?? '—')}`);
    }
    if (input.status && ['Resolvida', 'Encerrada'].includes(input.status) && !['Resolvida', 'Encerrada'].includes(occurrence.status)) {
      fields.push('closed_at = ?');
      values.push(now());
    }
    if (input.status && !['Resolvida', 'Encerrada'].includes(input.status)) {
      fields.push('closed_at = ?');
      values.push(null);
    }
    if (fields.length === 0) fail(400, 'Nenhum campo informado.');
    fields.push('updated_at = ?');
    values.push(now());
    values.push(occurrence.id, company);
    run(`UPDATE occurrences SET ${fields.join(', ')} WHERE id = ? AND company_id = ?`, ...values);
    if (changes.length > 0) addOccurrenceHistory(company, occurrence.id, auth(req).id, 'Informações atualizadas', changes.join(' | '));
    if (input.status && input.status !== occurrence.status) {
      addOccurrenceHistory(company, occurrence.id, auth(req).id, 'Status alterado', `${occurrence.status} → ${input.status}`);
      notifyCompany(company, 'Status de ocorrência alterado', `${occurrence.customer_name}: ${input.status}`, auth(req).id);
    }
    logActivity(company, auth(req).id, 'occurrence_updated', 'occurrence', occurrence.id, input);
    res.json({ occurrence: formatOccurrence(getOccurrence(company, occurrence.id)) });
  })
);

occurrenceRoutes.delete(
  '/:id',
  authRequired,
  adminRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const occurrence = getOccurrence(company, req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    run('DELETE FROM occurrences WHERE id = ? AND company_id = ?', occurrence.id, company);
    logActivity(company, auth(req).id, 'occurrence_deleted', 'occurrence', occurrence.id, { code: `OC-${occurrence.number}` });
    res.json({ ok: true });
  })
);
