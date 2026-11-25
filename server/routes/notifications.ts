import { Router } from 'express';
import { asyncRoute, authRequired, auth } from '../core.ts';
import { all, now, run } from '../db.ts';

export const notificationRoutes = Router();

notificationRoutes.get(
  '/',
  authRequired,
  asyncRoute(async (req, res) => {
    const unreadOnly = req.query.unread === '1';
    const notifications = all<any>(
      `SELECT id, type, title, body, read_at, created_at FROM notifications
       WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC LIMIT 100`,
      auth(req).id
    );
    const unread = notifications.filter((item) => !item.read_at).length;
    res.json({
      notifications: notifications.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body ?? null,
        readAt: item.read_at ?? null,
        createdAt: item.created_at
      })),
      unread
    });
  })
);

notificationRoutes.patch(
  '/read-all',
  authRequired,
  asyncRoute(async (req, res) => {
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), auth(req).id);
    res.json({ ok: true });
  })
);

notificationRoutes.patch(
  '/:id/read',
  authRequired,
  asyncRoute(async (req, res) => {
    run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', now(), req.params.id, auth(req).id);
    res.json({ ok: true });
  })
);
