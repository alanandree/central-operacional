import { Router } from 'express';
import { asyncRoute, authRequired, companyId, pagination } from '../core.ts';
import { all } from '../db.ts';

export const documentRoutes = Router();

documentRoutes.get(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const search = String(req.query.search || '').trim().toLowerCase();
    const type = String(req.query.type || '');
    const driverId = String(req.query.driverId || '');
    const occurrenceId = String(req.query.occurrenceId || '');
    const { limit, offset } = pagination(req);

    const driverDocs = all<any>(
      `SELECT dd.id AS link_id, dd.type AS doc_type, dd.created_at, d.name AS owner_name, d.id AS owner_id,
        f.id, f.name, f.mime, f.size
       FROM driver_documents dd
       JOIN files f ON f.id = dd.file_id
       JOIN drivers d ON d.id = dd.driver_id
       WHERE dd.company_id = ?`,
      company
    ).map((row) => ({
      ...row,
      source: 'driver',
      context: 'Motorista',
      category: row.doc_type,
      url: `/api/files/${row.id}/download`
    }));

    const occurrenceDocs = all<any>(
      `SELECT a.id AS link_id, 'Anexo' AS doc_type, a.created_at,
        CONCAT('OC-', printf('%05d', o.number)) AS owner_name, o.id AS owner_id,
        f.id, f.name, f.mime, f.size
       FROM occurrence_attachments a
       JOIN files f ON f.id = a.file_id
       JOIN occurrences o ON o.id = a.occurrence_id
       WHERE a.company_id = ?`,
      company
    ).map((row) => ({
      ...row,
      source: 'occurrence',
      context: 'Ocorrência',
      category: row.doc_type,
      url: `/api/files/${row.id}/download`
    }));

    let items = [...driverDocs, ...occurrenceDocs];
    if (type) items = items.filter((item) => item.doc_type === type);
    if (driverId) items = items.filter((item) => item.source === 'driver' && item.owner_id === driverId);
    if (occurrenceId) items = items.filter((item) => item.source === 'occurrence' && item.owner_id === occurrenceId);
    if (search) {
      items = items.filter((item) => `${item.name} ${item.owner_name} ${item.category}`.toLowerCase().includes(search));
    }
    items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const total = items.length;
    items = items.slice(offset, offset + limit);
    res.json({ items, total, page: Math.floor(offset / limit) + 1, limit });
  })
);
