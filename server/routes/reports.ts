import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { asyncRoute, authRequired, companyId } from '../core.ts';
import { all, one } from '../db.ts';

export const reportRoutes = Router();

function period(req: { query: any }) {
  const to = req.query.to ? new Date(String(req.query.to)).toISOString() : new Date().toISOString();
  const from = req.query.from ? new Date(String(req.query.from)).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
  return { from, to };
}

function sacData(company: string, from: string, to: string) {
  const total = one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM occurrences WHERE company_id = ? AND received_at BETWEEN ? AND ?',
    company,
    from,
    to
  )?.n ?? 0;
  const resolved = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM occurrences WHERE company_id = ? AND status IN ('Resolvida', 'Encerrada') AND received_at BETWEEN ? AND ?",
    company,
    from,
    to
  )?.n ?? 0;
  const overdue = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM occurrences WHERE company_id = ? AND due_at IS NOT NULL AND due_at < ? AND status NOT IN ('Resolvida', 'Encerrada') AND received_at BETWEEN ? AND ?",
    company,
    new Date().toISOString(),
    from,
    to
  )?.n ?? 0;
  const avg = one<{ n: number | null }>(
    `SELECT AVG((julianday(closed_at) - julianday(received_at)) * 24) AS n FROM occurrences
     WHERE company_id = ? AND closed_at IS NOT NULL AND received_at BETWEEN ? AND ?`,
    company,
    from,
    to
  )?.n ?? null;
  const onTime = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM occurrences
     WHERE company_id = ? AND closed_at IS NOT NULL AND due_at IS NOT NULL AND closed_at <= due_at AND received_at BETWEEN ? AND ?`,
    company,
    from,
    to
  )?.n ?? 0;
  const byCategory = all<any>(
    `SELECT COALESCE(c.name, 'Sem categoria') AS label, COUNT(*) AS total
     FROM occurrences o LEFT JOIN occurrence_categories c ON c.id = o.category_id
     WHERE o.company_id = ? AND o.received_at BETWEEN ? AND ?
     GROUP BY COALESCE(c.name, 'Sem categoria') ORDER BY total DESC`,
    company,
    from,
    to
  );
  const byStatus = all<any>(
    `SELECT status AS label, COUNT(*) AS total FROM occurrences
     WHERE company_id = ? AND received_at BETWEEN ? AND ? GROUP BY status ORDER BY total DESC`,
    company,
    from,
    to
  );
  return {
    period: { from, to },
    total,
    resolved,
    overdue,
    averageResolutionHours: avg === null ? null : Number(avg.toFixed(1)),
    onTimePercent: resolved ? Number(((onTime / resolved) * 100).toFixed(1)) : 0,
    byCategory,
    byStatus
  };
}

function driverData(company: string, from: string, to: string) {
  const total = one<{ n: number }>('SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND created_at BETWEEN ? AND ?', company, from, to)?.n ?? 0;
  const pending = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND status NOT IN ('Aprovado', 'Reprovado', 'Inativo') AND created_at BETWEEN ? AND ?",
    company,
    from,
    to
  )?.n ?? 0;
  const approved = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND status = 'Aprovado' AND created_at BETWEEN ? AND ?",
    company,
    from,
    to
  )?.n ?? 0;
  const rejected = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND status = 'Reprovado' AND created_at BETWEEN ? AND ?",
    company,
    from,
    to
  )?.n ?? 0;
  const incomplete = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND status IN ('Aguardando documentos', 'Documentação incompleta') AND created_at BETWEEN ? AND ?",
    company,
    from,
    to
  )?.n ?? 0;
  const expiring = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND cnh_expiry IS NOT NULL
     AND cnh_expiry >= ? AND cnh_expiry <= ? AND created_at BETWEEN ? AND ?`,
    company,
    new Date().toISOString(),
    new Date(Date.now() + 30 * 86400000).toISOString(),
    from,
    to
  )?.n ?? 0;
  const byStatus = all<any>(
    'SELECT status AS label, COUNT(*) AS total FROM drivers WHERE company_id = ? AND created_at BETWEEN ? AND ? GROUP BY status ORDER BY total DESC',
    company,
    from,
    to
  );
  return { period: { from, to }, total, pending, approved, rejected, incompleteDocs: incomplete, expiringCnh: expiring, byStatus };
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '\uFEFF';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvCell).join(';')];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(';'));
  return `\uFEFF${lines.join('\r\n')}`;
}

function sendPdf(res: import('express').Response, title: string, rows: Array<[string, string | number]>): void {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.on('end', () => {
    const buffer = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.toLowerCase().replace(/\s+/g, '-')}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  });
  doc.fontSize(18).text(title);
  doc.moveDown();
  doc.fontSize(10);
  for (const [label, value] of rows) {
    doc.text(`${label}: ${value}`);
  }
  doc.end();
}

reportRoutes.get('/sac', authRequired, asyncRoute(async (req, res) => {
  const { from, to } = period(req);
  res.json(sacData(companyId(req), from, to));
}));

reportRoutes.get('/sac.csv', authRequired, asyncRoute(async (req, res) => {
  const { from, to } = period(req);
  const data = sacData(companyId(req), from, to);
  const rows = [
    { indicador: 'Total', valor: data.total },
    { indicador: 'Resolvidas', valor: data.resolved },
    { indicador: 'Atrasadas', valor: data.overdue },
    { indicador: 'Tempo médio (h)', valor: data.averageResolutionHours ?? 0 },
    { indicador: 'Dentro do prazo (%)', valor: data.onTimePercent },
    ...data.byCategory.map((item: any) => ({ indicador: `Categoria: ${item.label}`, valor: item.total })),
    ...data.byStatus.map((item: any) => ({ indicador: `Status: ${item.label}`, valor: item.total }))
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-sac.csv"');
  res.send(toCsv(rows));
}));

reportRoutes.get('/sac.pdf', authRequired, asyncRoute(async (req, res) => {
  const { from, to } = period(req);
  const data = sacData(companyId(req), from, to);
  sendPdf(res, 'Relatorio SAC', [
    ['Período', `${from.slice(0, 10)} a ${to.slice(0, 10)}`],
    ['Total de ocorrências', data.total],
    ['Resolvidas', data.resolved],
    ['Atrasadas', data.overdue],
    ['Tempo médio de resolução (h)', data.averageResolutionHours ?? 0],
    ['Dentro do prazo', `${data.onTimePercent}%`],
    ...data.byCategory.map((item: any) => [`Categoria ${item.label}`, item.total]) as Array<[string, string | number]>
  ]);
}));

reportRoutes.get('/drivers', authRequired, asyncRoute(async (req, res) => {
  const { from, to } = period(req);
  res.json(driverData(companyId(req), from, to));
}));

reportRoutes.get('/drivers.csv', authRequired, asyncRoute(async (req, res) => {
  const { from, to } = period(req);
  const data = driverData(companyId(req), from, to);
  const rows = [
    { indicador: 'Total', valor: data.total },
    { indicador: 'Pendentes', valor: data.pending },
    { indicador: 'Aprovados', valor: data.approved },
    { indicador: 'Reprovados', valor: data.rejected },
    { indicador: 'Documentos incompletos', valor: data.incompleteDocs },
    { indicador: 'CNHs próximas do vencimento', valor: data.expiringCnh },
    ...data.byStatus.map((item: any) => ({ indicador: `Status: ${item.label}`, valor: item.total }))
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-motoristas.csv"');
  res.send(toCsv(rows));
}));

reportRoutes.get('/drivers.pdf', authRequired, asyncRoute(async (req, res) => {
  const { from, to } = period(req);
  const data = driverData(companyId(req), from, to);
  sendPdf(res, 'Relatorio Motoristas', [
    ['Período', `${from.slice(0, 10)} a ${to.slice(0, 10)}`],
    ['Total', data.total],
    ['Pendentes', data.pending],
    ['Aprovados', data.approved],
    ['Reprovados', data.rejected],
    ['Documentos incompletos', data.incompleteDocs],
    ['CNHs próximas do vencimento', data.expiringCnh]
  ]);
}));
