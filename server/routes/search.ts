import { Router } from 'express';
import { asyncRoute, authRequired, companyId } from '../core.ts';
import { all } from '../db.ts';

export const searchRoutes = Router();

searchRoutes.get(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) {
      res.json({ groups: [] });
      return;
    }
    const company = companyId(req);
    const term = `%${query}%`;

    const occurrences = all<any>(
      `SELECT id, number, customer_name, order_code, tracking_code, status
       FROM occurrences WHERE company_id = ? AND (customer_name LIKE ? OR order_code LIKE ? OR tracking_code LIKE ? OR CAST(number AS TEXT) LIKE ?)
       ORDER BY created_at DESC LIMIT 8`,
      company,
      term,
      term,
      term,
      term
    ).map((row) => ({
      id: row.id,
      title: `OC-${String(row.number).padStart(5, '0')} • ${row.customer_name}`,
      subtitle: `${row.status}${row.order_code ? ` • Pedido ${row.order_code}` : ''}`,
      to: `/ocorrencias/${row.id}`
    }));

    const drivers = all<any>(
      `SELECT id, name, cpf, phone FROM drivers
       WHERE company_id = ? AND (name LIKE ? OR cpf LIKE ? OR phone LIKE ? OR cnh_number LIKE ?)
       ORDER BY created_at DESC LIMIT 8`,
      company,
      term,
      term,
      term,
      term
    ).map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: `CPF ${row.cpf}${row.phone ? ` • ${row.phone}` : ''}`,
      to: `/motoristas/${row.id}`
    }));

    const files = all<any>(
      `SELECT id, name, mime FROM files WHERE company_id = ? AND name LIKE ? ORDER BY created_at DESC LIMIT 8`,
      company,
      term
    ).map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: row.mime,
      to: `/documentos?q=${encodeURIComponent(query)}`
    }));

    const messages = all<any>(
      `SELECT id, from_number, body, occurred_at FROM whatsapp_messages
       WHERE company_id = ? AND body LIKE ? ORDER BY occurred_at DESC LIMIT 8`,
      company,
      term
    ).map((row) => ({
      id: row.id,
      title: row.from_number || 'Mensagem WhatsApp',
      subtitle: String(row.body || '').slice(0, 90),
      to: '/whatsapp'
    }));

    const groups = [
      { label: 'Ocorrências', items: occurrences },
      { label: 'Motoristas', items: drivers },
      { label: 'Documentos', items: files },
      { label: 'Mensagens', items: messages }
    ].filter((group) => group.items.length > 0);

    res.json({ groups });
  })
);
