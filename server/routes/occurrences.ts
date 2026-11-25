import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  addOccurrenceHistory, all, logActivity, newId, nextOccurrenceNumber, notify, now, one, run, transaction
} from '../db.ts';
import { adminRequired, asyncRoute, auth, authRequired, companyId, fail, pagination } from '../core.ts';
import { config } from '../config.ts';
import { saveFile, upload } from '../upload.ts';
import { businessMinutesBetween, computeDueAt, loadSlaConfig, slaState } from '../sla.ts';

export const occurrenceRoutes = Router();

const statuses = ['Nova', 'Em análise', 'Em andamento', 'Aguardando cliente', 'Aguardando transportadora', 'Aguardando motorista', 'Resolvida', 'Encerrada'] as const;
const priorities = ['Baixa', 'Normal', 'Alta', 'Urgente'] as const;
const legacyStatuses: Record<string, string> = {
  'Nova ocorrência': 'Nova',
  'Aguardando retorno': 'Aguardando cliente'
};

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
  status: z.enum(statuses).default('Nova'),
  closeReason: z.string().min(3).optional()
});

const updateSchema = createSchema.partial().extend({
  closeReason: z.string().min(3).optional()
});

function clean(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

function normalizeStatus(value: string): string {
  return legacyStatuses[value] ?? value;
}

function categorySla(company: string, categoryId: string | null | undefined): number {
  if (categoryId) {
    const category = one<{ sla_hours: number }>(
      'SELECT sla_hours FROM occurrence_categories WHERE id = ? AND company_id = ?',
      categoryId,
      company
    );
    if (category) return category.sla_hours;
  }
  return loadSlaConfig(company).defaultHours;
}

function parseDateFilter(value: unknown, endOfDay = false): string {
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
    if (Number.isNaN(date.getTime())) fail(400, 'Data inválida.');
    return date.toISOString();
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) fail(400, 'Data inválida.');
  return date.toISOString();
}

function formatOccurrence(row: any) {
  const company = row.company_id ?? row.companyId;
  const sla = slaState(
    {
      received_at: row.received_at,
      due_at: row.due_at,
      status: normalizeStatus(row.status),
      sla_paused_at: row.sla_paused_at ?? null,
      sla_pause_minutes: row.sla_pause_minutes ?? 0,
      sla_target_minutes: row.sla_target_minutes ?? null,
      closed_at: row.closed_at ?? null
    },
    loadSlaConfig(company)
  );
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
    dueAt: sla.dueAt,
    originalDueAt: row.due_at ?? null,
    status: normalizeStatus(row.status),
    closeReason: row.close_reason ?? null,
    closedAt: row.closed_at ?? null,
    sla,
    overdue: sla.status === 'overdue' || sla.status === 'breached',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.author_name ?? null,
    messageCount: Number(row.message_count) || 0,
    attachmentCount: Number(row.attachment_count) || 0
  };
}

function getOccurrence(company: string, id: string) {
  return one<any>(
    `SELECT o.*, c.name AS category_name, u.name AS author_name,
       (SELECT COUNT(*) FROM whatsapp_messages m WHERE m.occurrence_id = o.id AND m.company_id = o.company_id) AS message_count,
       (SELECT COUNT(*) FROM occurrence_attachments a WHERE a.occurrence_id = o.id AND a.company_id = o.company_id) AS attachment_count
      FROM occurrences o
      LEFT JOIN occurrence_categories c ON c.id = o.category_id
      LEFT JOIN users u ON u.id = o.created_by
      WHERE o.id = ? AND o.company_id = ?`,
    id,
    company
  );
}

function notifyCompany(company: string, title: string, body: string, excludeUserId?: string): void {
  for (const user of all<{ id: string }>('SELECT id FROM users WHERE company_id = ?', company)) {
    if (user.id !== excludeUserId) notify(company, user.id, 'occurrence', title, body);
  }
}

function removeFiles(ids: string[]): void {
  for (const id of ids) {
    const file = one<{ stored_name: string }>('SELECT stored_name FROM files WHERE id = ?', id);
    if (file) {
      try {
        fs.unlinkSync(path.join(config.uploadDir, file.stored_name));
      } catch {
        undefined;
      }
      run('DELETE FROM files WHERE id = ?', id);
    }
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
      conditions.push('(o.customer_name LIKE ? OR o.order_code LIKE ? OR o.tracking_code LIKE ? OR o.description LIKE ? OR CAST(o.number AS TEXT) LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }
    if (req.query.categoryId) {
      conditions.push('o.category_id = ?');
      params.push(String(req.query.categoryId));
    }
    if (req.query.status) {
      conditions.push('o.status = ?');
      params.push(normalizeStatus(String(req.query.status)));
    }
    if (req.query.priority) {
      conditions.push('o.priority = ?');
      params.push(String(req.query.priority));
    }
    if (req.query.responsible) {
      conditions.push('o.responsible LIKE ?');
      params.push(`%${String(req.query.responsible)}%`);
    }
    if (req.query.from) {
      conditions.push('o.received_at >= ?');
      params.push(parseDateFilter(req.query.from));
    }
    if (req.query.to) {
      conditions.push('o.received_at <= ?');
      params.push(parseDateFilter(req.query.to, true));
    }
    if (req.query.closedFrom) {
      conditions.push('o.closed_at >= ?');
      params.push(parseDateFilter(req.query.closedFrom));
    }
    if (req.query.closedTo) {
      conditions.push('o.closed_at <= ?');
      params.push(parseDateFilter(req.query.closedTo, true));
    }
    if (req.query.sla === 'overdue') {
      conditions.push("o.status NOT IN ('Resolvida', 'Encerrada') AND o.due_at IS NOT NULL AND o.due_at < ?");
      params.push(now());
    }
    if (req.query.sla === 'paused') {
      conditions.push('o.sla_paused_at IS NOT NULL');
    }

    const sortMap: Record<string, string> = {
      created: 'o.created_at DESC',
      recent: 'o.received_at DESC',
      received: 'o.received_at DESC',
      due: 'o.due_at IS NULL, o.due_at ASC',
      priority: "CASE o.priority WHEN 'Urgente' THEN 0 WHEN 'Alta' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, o.created_at DESC"
    };
    const orderBy = sortMap[String(req.query.sort || 'created')] ?? sortMap.created;
    const where = conditions.join(' AND ');
    const total = one<{ n: number }>(`SELECT COUNT(*) AS n FROM occurrences o WHERE ${where}`, ...params)?.n ?? 0;
    const rows = all<any>(
      `SELECT o.*, c.name AS category_name, u.name AS author_name,
         (SELECT COUNT(*) FROM whatsapp_messages m WHERE m.occurrence_id = o.id AND m.company_id = o.company_id) AS message_count,
         (SELECT COUNT(*) FROM occurrence_attachments a WHERE a.occurrence_id = o.id AND a.company_id = o.company_id) AS attachment_count
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
       LEFT JOIN users u ON u.id = h.created_by
       WHERE h.company_id = ? AND h.occurrence_id = ? ORDER BY h.created_at ASC`,
      companyId(req),
      req.params.id
    );
    res.json({ history });
  })
);

occurrenceRoutes.get(
  '/:id/pauses',
  authRequired,
  asyncRoute(async (req, res) => {
    const occurrence = getOccurrence(companyId(req), req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    const pauses = all<any>(
      'SELECT id, paused_at, resumed_at, pause_minutes, reason FROM sla_pauses WHERE company_id = ? AND occurrence_id = ? ORDER BY paused_at DESC',
      companyId(req),
      occurrence.id
    );
    res.json({ pauses });
  })
);

occurrenceRoutes.get(
  '/:id/messages',
  authRequired,
  asyncRoute(async (req, res) => {
    const occurrence = getOccurrence(companyId(req), req.params.id);
    if (!occurrence) fail(404, 'Ocorrência não encontrada.');
    const messages = all<any>(
      'SELECT id, direction, from_number, to_number, contact_name, body, media_mime, media_name, occurred_at, processed, processing_status FROM whatsapp_messages WHERE company_id = ? AND occurrence_id = ? ORDER BY occurred_at DESC',
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
      newId(), companyId(req), occurrence.id, file.id, now()
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
      occurrence.id
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
       LEFT JOIN users u ON u.id = h.created_by WHERE h.company_id = ? AND h.occurrence_id = ? ORDER BY h.created_at ASC`,
      companyId(req), occurrence.id
    );
    const attachments = all<any>(
      `SELECT f.id, f.name, f.mime, f.size, a.created_at FROM occurrence_attachments a
       JOIN files f ON f.id = a.file_id WHERE a.company_id = ? AND a.occurrence_id = ? ORDER BY a.created_at DESC`,
      companyId(req), occurrence.id
    );
    const messages = all<any>(
      'SELECT id, direction, from_number, contact_name, body, media_mime, media_name, occurred_at, processed, processing_status FROM whatsapp_messages WHERE company_id = ? AND occurrence_id = ? ORDER BY occurred_at DESC',
      companyId(req), occurrence.id
    );
    const pauses = all<any>(
      'SELECT id, paused_at, resumed_at, pause_minutes, reason FROM sla_pauses WHERE company_id = ? AND occurrence_id = ? ORDER BY paused_at DESC',
      companyId(req), occurrence.id
    );
    res.json({ occurrence: formatOccurrence(occurrence), history, attachments, messages, pauses });
  })
);

occurrenceRoutes.post(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const input = createSchema.parse(req.body);
    const company = companyId(req);
    const receivedAt = input.receivedAt ? parseDateFilter(input.receivedAt) : now();
    const cfg = loadSlaConfig(company);
    const computed = computeDueAt(
      receivedAt,
      categorySla(company, input.categoryId),
      input.priority,
      cfg
    );
    const dueAt = input.dueAt === undefined ? computed.dueAt : clean(input.dueAt);
    const status = normalizeStatus(input.status);
    const id = newId();
    const closeReason = ['Resolvida', 'Encerrada'].includes(status) ? input.closeReason ?? 'Encerramento registrado' : null;

    transaction(() => {
      const number = nextOccurrenceNumber(company);
      run(
        `INSERT INTO occurrences (
          id, company_id, number, customer_name, customer_phone, order_code, tracking_code, recipient_name,
          category_id, description, received_at, origin, responsible, priority, due_at, status, close_reason,
          sla_target_minutes, closed_at, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, company, number, input.customerName.trim(), clean(input.customerPhone), clean(input.orderCode),
        clean(input.trackingCode), clean(input.recipientName), clean(input.categoryId), input.description.trim(),
        receivedAt, input.origin?.trim() || 'Manual', clean(input.responsible), input.priority, dueAt,
        status, closeReason, computed.targetMinutes, closeReason ? now() : null, auth(req).id, now(), now()
      );
      addOccurrenceHistory(company, id, auth(req).id, 'Ocorrência recebida', `Origem: ${input.origin?.trim() || 'Manual'}`);
      addOccurrenceHistory(company, id, auth(req).id, 'Ocorrência registrada', `Prioridade: ${input.priority} • Prazo: ${dueAt}`);
      notifyCompany(company, 'Nova ocorrência registrada', `${input.customerName} • ${input.description.slice(0, 80)}`, auth(req).id);
    });

    logActivity(company, auth(req).id, 'occurrence_created', 'occurrence', id, { code: `OC-${one<{ number: number }>('SELECT number FROM occurrences WHERE id = ?', id)?.number ?? 0}` });
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
    const cfg = loadSlaConfig(company);
    const nextStatus = input.status ? normalizeStatus(input.status) : normalizeStatus(occurrence.status);
    const closing = ['Resolvida', 'Encerrada'].includes(nextStatus) && !['Resolvida', 'Encerrada'].includes(normalizeStatus(occurrence.status));
    const reopening = !['Resolvida', 'Encerrada'].includes(nextStatus) && ['Resolvida', 'Encerrada'].includes(normalizeStatus(occurrence.status));
    if (closing && !input.closeReason && !occurrence.close_reason) fail(400, 'Informe a justificativa para encerrar a ocorrência.');

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
      if (key === 'receivedAt' && value) value = parseDateFilter(value);
      if (key === 'status') value = normalizeStatus(String(value));
      fields.push(`${column} = ?`);
      values.push(value);
      changes.push(`${key}: ${String(value ?? '—')}`);
    }

    transaction(() => {
      if (input.priority !== undefined || input.categoryId !== undefined) {
        if (input.dueAt === undefined && !['Resolvida', 'Encerrada'].includes(nextStatus)) {
          const computed = computeDueAt(
            occurrence.received_at,
            categorySla(company, input.categoryId !== undefined ? input.categoryId : occurrence.category_id),
            input.priority ?? occurrence.priority,
            cfg
          );
          fields.push('sla_target_minutes = ?');
          values.push(computed.targetMinutes);
          if (!('dueAt' in input)) {
            fields.push('due_at = ?');
            values.push(computed.dueAt);
          }
        }
      }

      const enteringPause = cfg.pauseStatuses.includes(nextStatus) && !occurrence.sla_paused_at;
      const leavingPause = !cfg.pauseStatuses.includes(nextStatus) && Boolean(occurrence.sla_paused_at);
      if (enteringPause) {
        fields.push('sla_paused_at = ?');
        values.push(now());
        run(
          'INSERT INTO sla_pauses (id, company_id, occurrence_id, paused_at, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          newId(), company, occurrence.id, now(), nextStatus, auth(req).id, now()
        );
      }
      if (leavingPause) {
        const minutes = businessMinutesBetween(occurrence.sla_paused_at, now(), cfg);
        fields.push('sla_paused_at = ?', 'sla_pause_minutes = ?');
        values.push(null, (Number(occurrence.sla_pause_minutes) || 0) + minutes);
        run(
          'UPDATE sla_pauses SET resumed_at = ?, pause_minutes = ? WHERE company_id = ? AND occurrence_id = ? AND resumed_at IS NULL',
          now(), minutes, company, occurrence.id
        );
        addOccurrenceHistory(company, occurrence.id, auth(req).id, 'SLA retomado', `${minutes} minutos de pausa`);
      }

      if (closing) {
        fields.push('closed_at = ?', 'close_reason = ?');
        values.push(now(), input.closeReason ?? occurrence.close_reason ?? 'Encerramento registrado');
      }
      if (reopening) {
        const computed = computeDueAt(now(), categorySla(company, occurrence.category_id), input.priority ?? occurrence.priority, cfg);
        fields.push('closed_at = ?', 'close_reason = ?', 'due_at = ?', 'sla_target_minutes = ?');
        values.push(null, null, computed.dueAt, computed.targetMinutes);
      }
      if (input.status && !closing && !reopening && ['Resolvida', 'Encerrada'].includes(normalizeStatus(occurrence.status))) {
        fields.push('closed_at = ?');
        values.push(null);
      }

      if (fields.length === 0) fail(400, 'Nenhum campo informado.');
      fields.push('updated_at = ?');
      values.push(now());
      values.push(occurrence.id, company);
      run(`UPDATE occurrences SET ${fields.join(', ')} WHERE id = ? AND company_id = ?`, ...values);

      if (changes.length > 0) addOccurrenceHistory(company, occurrence.id, auth(req).id, 'Informações atualizadas', changes.join(' | '));
      if (input.status && nextStatus !== normalizeStatus(occurrence.status)) {
        addOccurrenceHistory(company, occurrence.id, auth(req).id, 'Status alterado', `${normalizeStatus(occurrence.status)} → ${nextStatus}`);
        notifyCompany(company, 'Status de ocorrência alterado', `${occurrence.customer_name}: ${nextStatus}`, auth(req).id);
      }
      if (enteringPause) addOccurrenceHistory(company, occurrence.id, auth(req).id, 'SLA pausado', `Motivo: ${nextStatus}`);
      if (closing) addOccurrenceHistory(company, occurrence.id, auth(req).id, 'Ocorrência encerrada', input.closeReason ?? 'Encerramento registrado');
      if (reopening) addOccurrenceHistory(company, occurrence.id, auth(req).id, 'Ocorrência reaberta', 'Prazo recalculado');
    });

    logActivity(company, auth(req).id, 'occurrence_updated', 'occurrence', occurrence.id, { status: nextStatus });
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
    const fileIds = all<{ file_id: string }>('SELECT file_id FROM occurrence_attachments WHERE company_id = ? AND occurrence_id = ?', company, occurrence.id).map((row) => row.file_id);
    transaction(() => {
      run('DELETE FROM occurrences WHERE id = ? AND company_id = ?', occurrence.id, company);
      removeFiles(fileIds);
    });
    logActivity(company, auth(req).id, 'occurrence_deleted', 'occurrence', occurrence.id, { code: `OC-${occurrence.number}` });
    res.json({ ok: true });
  })
);
