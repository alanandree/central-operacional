import { Router } from 'express';
import { asyncRoute, authRequired, companyId } from '../core.ts';
import { all, one } from '../db.ts';
import { aiConfigured, callAIText } from '../integrations.ts';

export const dashboardRoutes = Router();

function count(sql: string, ...params: any[]): number {
  return one<{ n: number }>(sql, ...params)?.n ?? 0;
}

function bucketDate(value: string, mode: 'day' | 'week' | 'month'): string {
  const date = new Date(value);
  if (mode === 'day') return date.toISOString().slice(0, 10);
  if (mode === 'week') {
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 7);
}

dashboardRoutes.get(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const nowIso = new Date().toISOString();
    const metrics = {
      open: count("SELECT COUNT(*) AS n FROM occurrences WHERE company_id = ? AND status NOT IN ('Resolvida', 'Encerrada')", company),
      inProgress: count("SELECT COUNT(*) AS n FROM occurrences WHERE company_id = ? AND status = 'Em andamento'", company),
      waitingResponse: count("SELECT COUNT(*) AS n FROM occurrences WHERE company_id = ? AND status = 'Aguardando retorno'", company),
      concluded: count("SELECT COUNT(*) AS n FROM occurrences WHERE company_id = ? AND status IN ('Resolvida', 'Encerrada')", company),
      overdue: count("SELECT COUNT(*) AS n FROM occurrences WHERE company_id = ? AND due_at IS NOT NULL AND due_at < ? AND status NOT IN ('Resolvida', 'Encerrada')", company, nowIso),
      drivers: count('SELECT COUNT(*) AS n FROM drivers WHERE company_id = ?', company),
      pendingDrivers: count("SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND status NOT IN ('Aprovado', 'Reprovado', 'Inativo')", company),
      expiringDocuments: count(
        "SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND cnh_expiry IS NOT NULL AND cnh_expiry >= ? AND cnh_expiry <= ?",
        company,
        nowIso,
        new Date(Date.now() + 30 * 86400000).toISOString()
      )
    };

    const occurrences = all<{ received_at: string; category_id: string | null; status: string; due_at: string | null; customer_name: string; number: number }>(
      'SELECT received_at, category_id, status, due_at, customer_name, number FROM occurrences WHERE company_id = ?',
      company
    );

    function series(mode: 'day' | 'week' | 'month', periods: number) {
      const map = new Map<string, number>();
      for (const occurrence of occurrences) {
        const key = bucketDate(occurrence.received_at, mode);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      const result: Array<{ label: string; total: number }> = [];
      const cursor = new Date();
      if (mode === 'day') cursor.setDate(cursor.getDate() - (periods - 1));
      if (mode === 'week') cursor.setDate(cursor.getDate() - (periods - 1) * 7);
      if (mode === 'month') cursor.setMonth(cursor.getMonth() - (periods - 1));
      for (let index = 0; index < periods; index += 1) {
        const key = bucketDate(cursor.toISOString(), mode);
        result.push({ label: key, total: map.get(key) ?? 0 });
        if (mode === 'day') cursor.setDate(cursor.getDate() + 1);
        if (mode === 'week') cursor.setDate(cursor.getDate() + 7);
        if (mode === 'month') cursor.setMonth(cursor.getMonth() + 1);
      }
      return result;
    }

    const categories = all<{ name: string; total: number }>(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name, COUNT(*) AS total
       FROM occurrences o LEFT JOIN occurrence_categories c ON c.id = o.category_id
       WHERE o.company_id = ? GROUP BY COALESCE(c.name, 'Sem categoria') ORDER BY total DESC LIMIT 8`,
      company
    );

    const activities = all<any>(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.created_at, u.name AS user_name
       FROM activity_logs a JOIN users u ON u.id = a.user_id
       WHERE a.company_id = ? ORDER BY a.created_at DESC LIMIT 8`,
      company
    );

    const upcoming = all<any>(
      `SELECT id, number, customer_name, due_at, priority, status FROM occurrences
       WHERE company_id = ? AND due_at IS NOT NULL AND status NOT IN ('Resolvida', 'Encerrada')
       ORDER BY due_at ASC LIMIT 8`,
      company
    ).map((row) => ({ ...row, code: `OC-${String(row.number).padStart(5, '0')}` }));

    const deterministicSummary = `Existem ${metrics.open} ocorrências abertas, sendo ${metrics.overdue} atrasadas. Foram concluídas ${metrics.concluded} ocorrências. Há ${metrics.pendingDrivers} cadastros de motoristas pendentes e ${metrics.expiringDocuments} CNHs próximas do vencimento.`;
    let summary = deterministicSummary;
    let summarySource = 'calculated';

    if (aiConfigured()) {
      try {
        summary = await callAIText(
          'Você é um assistente operacional. Responda em português do Brasil, em no máximo 3 frases, usando apenas os números fornecidos. Não invente dados.',
          JSON.stringify(metrics)
        );
        summarySource = 'ai';
      } catch {
        summarySource = 'calculated_fallback';
      }
    }

    res.json({
      metrics,
      charts: { day: series('day', 14), week: series('week', 8), month: series('month', 6), categories },
      activities,
      upcoming,
      summary,
      summarySource
    });
  })
);
