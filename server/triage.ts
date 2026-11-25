import { z } from 'zod';
import {
  addOccurrenceHistory, all, logActivity, newId, nextOccurrenceNumber, notifyAdmins, now, one, parseJson, run, transaction
} from './db.ts';
import { config } from './config.ts';
import { aiConfigured, callAIJson } from './integrations.ts';
import { computeDueAt, loadSlaConfig } from './sla.ts';

export interface TriageAnalysis {
  isComplaint: boolean;
  category: string | null;
  customerName: string | null;
  customerPhone: string | null;
  orderCode: string | null;
  trackingCode: string | null;
  driverName: string | null;
  occurrenceType: string | null;
  description: string;
  mentionedDate: string | null;
  additionalInfo: string | null;
  priority: 'Baixa' | 'Normal' | 'Alta' | 'Urgente';
  missingFields: string[];
  confidence: number;
  source: 'ia' | 'regras';
}

const keywordRules: Array<[string, string[]]> = [
  ['Pedido extraviado', ['extraviad', 'perdid', 'não chegou', 'nao chegou', 'desapareceu']],
  ['Produto não recebido', ['não recebi', 'nao recebi', 'não entregue', 'nao entregue']],
  ['Produto danificado', ['danificad', 'quebrad', 'avariad', 'amassad']],
  ['Entrega incompleta', ['incomplet', 'faltou', 'faltando', 'parcial']],
  ['Atraso na entrega', ['atras', 'demora', 'tardia']],
  ['Problema com entregador', ['entregador', 'motorista', 'entrega errada']],
  ['Endereço incorreto', ['endereço', 'endereco', 'localização errada', 'localizacao errada']],
  ['Problema de coleta', ['coleta', 'retirada']]
];

const complaintKeywords = ['entrega', 'pedido', 'produto', 'extravi', 'atras', 'danific', 'falt', 'motorista', 'entregador', 'reclama', 'problema'];

function extractFirst(message: string, pattern: RegExp): string | null {
  const match = message.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function localAnalysis(message: string, categories: string[]): TriageAnalysis {
  const lower = message.toLowerCase();
  const matchedRule = keywordRules.find(([, words]) => words.some((word) => lower.includes(word)));
  const category = matchedRule && categories.includes(matchedRule[0]) ? matchedRule[0] : null;
  const isComplaint = complaintKeywords.some((word) => lower.includes(word));
  const priority: TriageAnalysis['priority'] =
    /urgente|emergên|emergen|imediat|hoje/.test(lower) ? 'Urgente'
      : /extravi|danific|quebrad|roubad/.test(lower) ? 'Alta'
        : /atras|demora|falt/.test(lower) ? 'Normal' : 'Baixa';
  const customerPhone = extractFirst(message, /(?:\+?55\s?)?\(?\d{2}\)?\s?\d{4,5}-?\d{4}/);
  const orderCode = extractFirst(message, /(?:pedido|order)\s*(?:n[º°#]?\s*)?([A-Za-z0-9-]{5,20})/i);
  const trackingCode = extractFirst(message, /(?:rastreio|tracking| código)\s*([A-Za-z0-9-]{5,30})/i);
  const driverName = extractFirst(message, /(?:motorista|entregador)\s+([A-ZÀ-ÿ][\wÀ-ÿ ]{2,50})/i);
  const mentionedDate = extractFirst(message, /\b(\d{2}\/\d{2}\/\d{4})\b/);
  const missingFields: string[] = [];
  if (!/cliente|nome|sou|me chamo/.test(lower)) missingFields.push('customerName');
  if (!customerPhone) missingFields.push('customerPhone');
  if (!orderCode) missingFields.push('orderCode');
  if (!trackingCode) missingFields.push('trackingCode');
  if (!driverName) missingFields.push('driverName');
  if (!category) missingFields.push('category');
  return {
    isComplaint,
    category,
    customerName: extractFirst(message, /(?:me chamo|cliente|nome)\s+([A-ZÀ-ÿ][\wÀ-ÿ ]{2,50})/i),
    customerPhone,
    orderCode,
    trackingCode,
    driverName,
    occurrenceType: category,
    description: message.trim(),
    mentionedDate,
    additionalInfo: null,
    priority,
    missingFields,
    confidence: matchedRule ? 0.72 : 0.45,
    source: 'regras'
  };
}

function normalizePriority(value: unknown): TriageAnalysis['priority'] {
  return ['Baixa', 'Normal', 'Alta', 'Urgente'].includes(String(value))
    ? value as TriageAnalysis['priority']
    : 'Normal';
}

export async function analyzeMessage(company: string, message: string): Promise<TriageAnalysis> {
  const categories = all<{ name: string }>(
    'SELECT name FROM occurrence_categories WHERE company_id = ? AND active = 1 ORDER BY name',
    company
  ).map((row) => row.name);
  if (!aiConfigured()) return localAnalysis(message, categories);
  try {
    const raw = await callAIJson<Record<string, unknown>>(
      `Você faz triagem de mensagens de SAC de entregas. Responda apenas JSON com: isComplaint (boolean), category (string ou null), customerName, customerPhone, orderCode, trackingCode, driverName, occurrenceType, description, mentionedDate, additionalInfo, suggestedPriority (Baixa|Normal|Alta|Urgente), missingFields (array), confidence (0 a 1). Extraia somente dados presentes na mensagem. Nunca invente. Categorias permitidas: ${categories.join(', ')}.`,
      message
    );
    const category = raw.category && categories.includes(String(raw.category)) ? String(raw.category) : null;
    const analysis: TriageAnalysis = {
      isComplaint: Boolean(raw.isComplaint),
      category,
      customerName: raw.customerName ? String(raw.customerName) : null,
      customerPhone: raw.customerPhone ? String(raw.customerPhone) : null,
      orderCode: raw.orderCode ? String(raw.orderCode) : null,
      trackingCode: raw.trackingCode ? String(raw.trackingCode) : null,
      driverName: raw.driverName ? String(raw.driverName) : null,
      occurrenceType: raw.occurrenceType ? String(raw.occurrenceType) : category,
      description: raw.description ? String(raw.description) : message.trim(),
      mentionedDate: raw.mentionedDate ? String(raw.mentionedDate) : null,
      additionalInfo: raw.additionalInfo ? String(raw.additionalInfo) : null,
      priority: normalizePriority(raw.suggestedPriority),
      missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.map(String) : [],
      confidence: Number(raw.confidence) || 0.8,
      source: 'ia'
    };
    if (!category && analysis.isComplaint && !analysis.missingFields.includes('category')) analysis.missingFields.push('category');
    return analysis;
  } catch {
    return { ...localAnalysis(message, categories), source: 'regras' };
  }
}

export function saveSuggestion(company: string, messageId: string | null, analysis: TriageAnalysis): string {
  const id = newId();
  run(
    `INSERT INTO ai_suggestions (
      id, company_id, message_id, is_complaint, category, customer_name, customer_phone, order_code,
      tracking_code, driver_name, occurrence_type, description, mentioned_date, additional_info,
      priority, missing_fields, confidence, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
    id, company, messageId, analysis.isComplaint ? 1 : 0, analysis.category, analysis.customerName,
    analysis.customerPhone, analysis.orderCode, analysis.trackingCode, analysis.driverName,
    analysis.occurrenceType, analysis.description, analysis.mentionedDate, analysis.additionalInfo,
    analysis.priority, JSON.stringify(analysis.missingFields), analysis.confidence, now()
  );
  if (analysis.isComplaint) {
    notifyAdmins(company, 'Sugestão de ocorrência', 'Uma mensagem pode gerar uma ocorrência. Revise na central WhatsApp.');
  }
  return id;
}

export function formatSuggestion(row: any) {
  return {
    id: row.id,
    messageId: row.message_id ?? null,
    occurrenceId: row.occurrence_id ?? null,
    isComplaint: Boolean(row.is_complaint),
    category: row.category ?? null,
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    orderCode: row.order_code ?? null,
    trackingCode: row.tracking_code ?? null,
    driverName: row.driver_name ?? null,
    occurrenceType: row.occurrence_type ?? null,
    description: row.description ?? null,
    mentionedDate: row.mentioned_date ?? null,
    additionalInfo: row.additional_info ?? null,
    priority: row.priority ?? 'Normal',
    missingFields: parseJson<string[]>(row.missing_fields, []),
    confidence: Number(row.confidence) || 0,
    status: row.status,
    source: row.source ?? 'regras',
    createdOccurrenceId: row.created_occurrence_id ?? null,
    reviewNotes: row.review_notes ?? null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? null,
    messageBody: row.message_body ?? null,
    messageFrom: row.message_from ?? null
  };
}

export function getSuggestion(company: string, id: string) {
  return one<any>(
    `SELECT s.*, m.body AS message_body, m.from_number AS message_from
     FROM ai_suggestions s LEFT JOIN whatsapp_messages m ON m.id = s.message_id
     WHERE s.id = ? AND s.company_id = ?`,
    id,
    company
  );
}

const approveSchema = z.object({
  customerName: z.string().min(2).optional(),
  customerPhone: z.string().max(40).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  priority: z.enum(['Baixa', 'Normal', 'Alta', 'Urgente']).optional(),
  description: z.string().min(3).optional(),
  orderCode: z.string().max(80).nullable().optional(),
  trackingCode: z.string().max(80).nullable().optional(),
  notes: z.string().max(300).optional()
});

export function approveSuggestion(company: string, userId: string, id: string, overrides: unknown) {
  const input = approveSchema.parse(overrides ?? {});
  const suggestion = getSuggestion(company, id);
  if (!suggestion) throw new Error('Sugestão não encontrada.');
  if (!['pendente', 'revisando'].includes(suggestion.status)) throw new Error('Esta sugestão já foi revisada.');
  const customerName = input.customerName ?? suggestion.customer_name;
  if (!customerName) throw new Error('Informe o nome do cliente para criar a ocorrência.');
  const description = input.description ?? suggestion.description ?? suggestion.message_body;
  if (!description) throw new Error('Não há descrição suficiente para criar a ocorrência.');
  const priority = input.priority ?? suggestion.priority ?? 'Normal';
  const cfg = loadSlaConfig(company);
  let categoryId = input.categoryId ?? null;
  if (categoryId === null && suggestion.category) {
    categoryId = one<{ id: string }>(
      'SELECT id FROM occurrence_categories WHERE company_id = ? AND name = ? AND active = 1',
      company, suggestion.category
    )?.id ?? null;
  }
  const categoryHours = categoryId
    ? one<{ sla_hours: number }>('SELECT sla_hours FROM occurrence_categories WHERE id = ? AND company_id = ?', categoryId, company)?.sla_hours ?? cfg.defaultHours
    : cfg.defaultHours;
  const computed = computeDueAt(now(), categoryHours, priority, cfg);
  const occurrenceId = newId();
  transaction(() => {
    const number = nextOccurrenceNumber(company);
    run(
      `INSERT INTO occurrences (
        id, company_id, number, customer_name, customer_phone, order_code, tracking_code, description,
        received_at, origin, category_id, priority, due_at, sla_target_minutes, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'WhatsApp', ?, ?, ?, ?, 'Nova', ?, ?, ?)`,
      occurrenceId, company, number, customerName.trim(), input.customerPhone ?? suggestion.customer_phone,
      input.orderCode ?? suggestion.order_code, input.trackingCode ?? suggestion.tracking_code,
      description.trim(), suggestion.message_from ? now() : now(), categoryId, priority,
      computed.dueAt, computed.targetMinutes, userId, now(), now()
    );
    addOccurrenceHistory(company, occurrenceId, userId, 'Ocorrência criada a partir do WhatsApp', `Sugestão: ${id}`);
    if (suggestion.message_id) {
      run(
        'UPDATE whatsapp_messages SET occurrence_id = ?, processed = 1, processing_status = ? WHERE id = ? AND company_id = ?',
        occurrenceId, 'convertida', suggestion.message_id, company
      );
    }
    run(
      'UPDATE ai_suggestions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?, created_occurrence_id = ?, occurrence_id = ? WHERE id = ? AND company_id = ?',
      'aprovada', userId, now(), input.notes ?? null, occurrenceId, occurrenceId, id, company
    );
    notifyAdmins(company, 'Ocorrência criada', `OC-${String(number).padStart(5, '0')} criada a partir de uma mensagem.`);
  });
  logActivity(company, userId, 'suggestion_approved', 'suggestion', id, { occurrenceId });
  return occurrenceId;
}

export function linkSuggestion(company: string, userId: string, id: string, occurrenceId: string): void {
  const suggestion = getSuggestion(company, id);
  if (!suggestion) throw new Error('Sugestão não encontrada.');
  const occurrence = one<{ id: string }>('SELECT id FROM occurrences WHERE id = ? AND company_id = ?', occurrenceId, company);
  if (!occurrence) throw new Error('Ocorrência não encontrada.');
  transaction(() => {
    if (suggestion.message_id) {
      run(
        'UPDATE whatsapp_messages SET occurrence_id = ?, processed = 1, processing_status = ? WHERE id = ? AND company_id = ?',
        occurrenceId, 'vinculada', suggestion.message_id, company
      );
    }
    run(
      'UPDATE ai_suggestions SET status = ?, occurrence_id = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND company_id = ?',
      'vinculada', occurrenceId, userId, now(), id, company
    );
    addOccurrenceHistory(company, occurrenceId, userId, 'Mensagem vinculada', `Sugestão: ${id}`);
  });
  logActivity(company, userId, 'suggestion_linked', 'suggestion', id, { occurrenceId });
}

export function rejectSuggestion(company: string, userId: string, id: string, notes?: string): void {
  const suggestion = getSuggestion(company, id);
  if (!suggestion) throw new Error('Sugestão não encontrada.');
  run(
    'UPDATE ai_suggestions SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND company_id = ?',
    'rejeitada', notes ?? null, userId, now(), id, company
  );
  if (suggestion.message_id) {
    run('UPDATE whatsapp_messages SET processing_status = ? WHERE id = ? AND company_id = ?', 'rejeitada', suggestion.message_id, company);
  }
  logActivity(company, userId, 'suggestion_rejected', 'suggestion', id, { notes: notes ?? null });
}

export function suggestionSourceLabel(source: string | null): string {
  return source === 'ia' ? `IA ${config.ai.model}` : 'Regras locais';
}
