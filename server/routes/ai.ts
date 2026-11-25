import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, auth, authRequired, companyId, pagination } from '../core.ts';
import { all, getSetting, logActivity, one } from '../db.ts';
import { aiConfigured, aiStatus, callAIJson, callAIText } from '../integrations.ts';
import { loadSlaConfig, slaState } from '../sla.ts';
import {
  analyzeMessage, approveSuggestion, formatSuggestion, getSuggestion, linkSuggestion,
  rejectSuggestion, saveSuggestion, suggestionSourceLabel
} from '../triage.ts';

export const aiRoutes = Router();

aiRoutes.get(
  '/status',
  asyncRoute(async (_req, res) => {
    res.json({ ...aiStatus(), sourceLabel: suggestionSourceLabel(aiConfigured() ? 'ia' : 'regras') });
  })
);

aiRoutes.get(
  '/suggestions',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const { limit, offset } = pagination(req);
    const conditions = ['s.company_id = ?'];
    const params: any[] = [company];
    if (req.query.status) {
      conditions.push('s.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.messageId) {
      conditions.push('s.message_id = ?');
      params.push(String(req.query.messageId));
    }
    const where = conditions.join(' AND ');
    const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM ai_suggestions s WHERE ${where}`, ...params)?.total ?? 0;
    const rows = all<any>(
      `SELECT s.*, m.body AS message_body, m.from_number AS message_from
       FROM ai_suggestions s LEFT JOIN whatsapp_messages m ON m.id = s.message_id
       WHERE ${where} ORDER BY s.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      ...params
    );
    res.json({ suggestions: rows.map(formatSuggestion), total, limit, offset });
  })
);

aiRoutes.post(
  '/analyze',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ message: z.string().min(5).max(8000), messageId: z.string().optional() }).parse(req.body);
    const company = companyId(req);
    if (body.messageId && !one<{ id: string }>('SELECT id FROM whatsapp_messages WHERE id = ? AND company_id = ?', body.messageId, company)) {
      res.status(404).json({ error: 'Mensagem não encontrada.' });
      return;
    }
    const analysis = await analyzeMessage(company, body.message);
    const id = saveSuggestion(company, body.messageId ?? null, analysis);
    const row = getSuggestion(company, id);
    logActivity(company, auth(req).id, 'ai_message_analyzed', 'suggestion', id, { source: analysis.source });
    res.json({ suggestion: formatSuggestion(row), requiresHumanConfirmation: true });
  })
);

aiRoutes.post(
  '/suggestions/:id/approve',
  authRequired,
  asyncRoute(async (req, res) => {
    const occurrenceId = approveSuggestion(companyId(req), auth(req).id, req.params.id, req.body ?? {});
    res.json({ ok: true, occurrenceId });
  })
);

aiRoutes.post(
  '/suggestions/:id/link',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ occurrenceId: z.string().min(1) }).parse(req.body);
    linkSuggestion(companyId(req), auth(req).id, req.params.id, body.occurrenceId);
    res.json({ ok: true });
  })
);

aiRoutes.post(
  '/suggestions/:id/reject',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ notes: z.string().max(300).optional() }).parse(req.body ?? {});
    rejectSuggestion(companyId(req), auth(req).id, req.params.id, body.notes);
    res.json({ ok: true });
  })
);

aiRoutes.post(
  '/similar',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ occurrenceId: z.string().optional(), text: z.string().min(5).optional() }).parse(req.body);
    const company = companyId(req);
    let text = body.text;
    if (body.occurrenceId) {
      const occurrence = one<{ description: string }>(
        'SELECT description FROM occurrences WHERE id = ? AND company_id = ?', body.occurrenceId, company
      );
      if (!occurrence) {
        res.status(404).json({ error: 'Ocorrência não encontrada.' });
        return;
      }
      text = occurrence.description;
    }
    if (!text) {
      res.status(400).json({ error: 'Informe occurrenceId ou text.' });
      return;
    }
    const tokens = tokenize(text);
    const candidates = all<{ id: string; number: number; customer_name: string; description: string; status: string; created_at: string }>(
      `SELECT id, number, customer_name, description, status, created_at FROM occurrences
       WHERE company_id = ? AND id IS NOT ? ORDER BY created_at DESC LIMIT 500`,
      company, body.occurrenceId ?? ''
    );
    const matches = candidates
      .map((item) => {
        const itemTokens = tokenize(item.description);
        const shared = tokens.filter((token) => itemTokens.includes(token));
        const score = tokens.length ? Math.round((shared.length / Math.min(tokens.length, itemTokens.length || 1)) * 100) : 0;
        return { ...item, score, sharedTerms: shared.slice(0, 8) };
      })
      .filter((item) => item.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    let insight: string | null = null;
    if (matches.length && aiConfigured()) {
      insight = await callAIText(
        'Compare as ocorrências semelhantes e aponte, em até 3 frases, o padrão mais provável e uma ação preventiva. Não invente dados.',
        occurrencesToText(matches)
      ).catch(() => null);
    }
    res.json({ matches, insight, source: aiConfigured() && insight ? 'ia' : 'regras' });
  })
);

aiRoutes.post(
  '/delays',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const cfg = loadSlaConfig(company);
    const rows = all<any>(
      `SELECT o.id, o.number, o.customer_name, o.description, o.priority, o.status, o.received_at, o.due_at,
              o.sla_paused_at, o.sla_pause_minutes, o.sla_target_minutes, o.closed_at,
              c.name AS category_name
       FROM occurrences o LEFT JOIN occurrence_categories c ON c.id = o.category_id
       WHERE o.company_id = ? AND o.status NOT IN ('Encerrada', 'Resolvida')
       ORDER BY o.due_at`,
      company
    );
    const alerts = rows
      .map((row) => {
        const sla = slaState(row, cfg);
        return {
          id: row.id,
          number: row.number,
          customerName: row.customer_name,
          category: row.category_name ?? null,
          priority: row.priority,
          status: row.status,
          dueAt: sla.dueAt,
          remainingMinutes: sla.remainingMinutes,
          progress: sla.progress,
          slaStatus: sla.status,
          description: row.description
        };
      })
      .filter((row) => row.slaStatus === 'overdue' || row.slaStatus === 'due_soon')
      .sort((a, b) => a.remainingMinutes - b.remainingMinutes);
    let summary: string | null = null;
    if (alerts.length && aiConfigured()) {
      summary = await callAIText(
        'Resuma os riscos de SLA em até 3 frases e sugira a ordem de priorização. Use apenas os dados informados.',
        alerts.map((item) => `${item.number} ${item.priority} ${item.slaStatus} restante=${item.remainingMinutes}min ${item.description}`).join('\n')
      ).catch(() => null);
    }
    res.json({ alerts, summary, source: aiConfigured() && summary ? 'ia' : 'regras' });
  })
);

aiRoutes.post(
  '/report',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ periodDays: z.number().int().min(1).max(365).optional() }).parse(req.body ?? {});
    const company = companyId(req);
    const days = body.periodDays ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const totals = one<any>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('Resolvida', 'Encerrada') THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN priority = 'Urgente' THEN 1 ELSE 0 END) AS urgent,
              SUM(CASE WHEN origin = 'WhatsApp' THEN 1 ELSE 0 END) AS fromWhatsapp
       FROM occurrences WHERE company_id = ? AND created_at >= ?`,
      company, since
    );
    const categories = all<{ name: string; total: number }>(
      `SELECT c.name, COUNT(*) AS total FROM occurrences o LEFT JOIN occurrence_categories c ON c.id = o.category_id
       WHERE o.company_id = ? AND o.created_at >= ? GROUP BY c.name ORDER BY total DESC LIMIT 8`,
      company, since
    );
    const alertDays = getSetting<number>(company, 'document_alert_days', 30);
    const expiryLimit = new Date(Date.now() + alertDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const drivers = one<{ total: number; approved: number; expiring: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'Ativo' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN cnh_expiry IS NOT NULL AND cnh_expiry <= ? THEN 1 ELSE 0 END) AS expiring
       FROM drivers WHERE company_id = ?`,
      expiryLimit, company
    );
    const facts = [
      `Período: últimos ${days} dias`,
      `Ocorrências: ${totals?.total ?? 0}; resolvidas: ${totals?.resolved ?? 0}; urgentes: ${totals?.urgent ?? 0}; via WhatsApp: ${totals?.fromWhatsapp ?? 0}`,
      `Categorias: ${categories.map((item) => `${item.name || 'Sem categoria'} (${item.total})`).join(', ') || 'nenhuma'}`,
      `Motoristas: ${drivers?.total ?? 0}; ativos: ${drivers?.approved ?? 0}; com documento próximo do vencimento: ${drivers?.expiring ?? 0}`
    ].join('\n');
    let report = facts;
    if (aiConfigured()) {
      report = await callAIText(
        'Transforme os dados operacionais em um relatório executivo em português do Brasil, com até 5 tópicos. Use somente os números informados.',
        facts
      ).catch(() => facts);
    }
    res.json({ report, facts, source: aiConfigured() ? 'ia' : 'dados', periodDays: days });
  })
);

function tokenize(value: string): string[] {
  const stop = new Set(['de', 'da', 'do', 'e', 'o', 'a', 'os', 'as', 'em', 'com', 'para', 'que', 'um', 'uma', 'no', 'na']);
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !stop.has(token));
}

function occurrencesToText(items: Array<{ number: number; description: string; status: string }>): string {
  return items.map((item) => `OC-${String(item.number).padStart(5, '0')} [${item.status}] ${item.description}`).join('\n');
}
