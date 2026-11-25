import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { asyncRoute, authRequired, companyId, fail } from '../core.ts';
import { one, run } from '../db.ts';

export const fileRoutes = Router();

fileRoutes.get(
  '/:id/download',
  authRequired,
  asyncRoute(async (req, res) => {
    const file = one<{ id: string; name: string; stored_name: string; mime: string; size: number }>(
      'SELECT id, name, stored_name, mime, size FROM files WHERE id = ? AND company_id = ?',
      req.params.id,
      companyId(req)
    );
    if (!file) fail(404, 'Arquivo não encontrado.');
    const filePath = path.join(config.uploadDir, file.stored_name);
    if (!fs.existsSync(filePath)) fail(404, 'Arquivo não encontrado no armazenamento.');
    const inline = req.query.download !== '1' && /^(image\/|application\/pdf$)/.test(file.mime);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(filePath).pipe(res);
  })
);

fileRoutes.delete(
  '/:id',
  authRequired,
  asyncRoute(async (req, res) => {
    const file = one<{ id: string; stored_name: string }>('SELECT id, stored_name FROM files WHERE id = ? AND company_id = ?', req.params.id, companyId(req));
    if (!file) fail(404, 'Arquivo não encontrado.');
    run('DELETE FROM files WHERE id = ?', file.id);
    const filePath = path.join(config.uploadDir, file.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  })
);
