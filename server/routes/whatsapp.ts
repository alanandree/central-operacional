import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, auth, authRequired, companyId, errorHandler, fail } from '../core.ts';
import { all, logActivity, newId, notify, now, one, run } from '../db.ts';
import { IntegrationError, markWhatsappSync, sendWhatsAppText, verifyWebhookSignature, whatsappConfigured, whatsappStatus } from '../integrations.ts';
import { config } from '../config.ts';

export const whatsappRoutes = Router();
export const webhookRoutes = Router();

whatsappRoutes.get(
  '/status',
  authRequired,
  asyncRoute(async (req, res) => {
    res.json(whatsappStatus(companyId(req)));
  })
);

whatsappRoutes.post(
  '/config',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ displayNumber: z.string().max(40).nullable().optional(), notes: z.string().max(500).nullable().optional() }).parse(req.body);
    const company = companyId(req);
    const current = one<{ id: string }>(
      'SELECT id FROM whatsapp_integrations WHERE company_id = ? AND provider = ?',
      company,
      'cloud_api'
    );
    if (current) {
      run(
        'UPDATE whatsapp_integrations SET display_number = ?, notes = ?, updated_at = ? WHERE id = ?',
        body.displayNumber ?? null,
        body.notes ?? null,
        now(),
        current.id
      );
    } else {
      run(
        'INSERT INTO whatsapp_integrations (id, company_id, provider, status, display_number, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId(),
        company,
        'cloud_api',
        whatsappConfigured() ? 'connected' : 'not_configured',
        body.displayNumber ?? null,
        body.notes ?? null,
        now(),
        now()
      );
    }
    logActivity(company, auth(req).id, 'whatsapp_config_updated', 'whatsapp', company, body);
    res.json({ ok: true, status: whatsappStatus(company) });
  })
);

whatsappRoutes.get(
  '/messages',
  authRequired,
  asyncRoute(async (req, res) => {
    const conditions = ['company_id = ?'];
    const params: any[] = [companyId(req)];
    if (req.query.occurrenceId) {
      conditions.push('occurrence_id = ?');
      params.push(String(req.query.occurrenceId));
    }
    if (req.query.processed === '0' || req.query.processed === '1') {
      conditions.push('processed = ?');
      params.push(Number(req.query.processed));
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const messages = all<any>(
      `SELECT id, wa_message_id, direction, from_number, to_number, body, occurred_at, occurrence_id, driver_id, processed
       FROM whatsapp_messages WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT ${limit}`,
      ...params
    );
    res.json({ messages });
  })
);

whatsappRoutes.post(
  '/messages/import',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        fromNumber: z.string().min(4),
        body: z.string().min(1),
        occurredAt: z.string().optional(),
        occurrenceId: z.string().nullable().optional(),
        driverId: z.string().nullable().optional()
      })
      .parse(req.body);
    const company = companyId(req);
    const id = newId();
    const occurredAt = body.occurredAt ? new Date(body.occurredAt).toISOString() : now();
    run(
      `INSERT INTO whatsapp_messages (id, company_id, direction, from_number, body, occurred_at, occurrence_id, driver_id, processed, created_at)
       VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, 0, ?)`,
      id,
      company,
      body.fromNumber,
      body.body,
      occurredAt,
      body.occurrenceId ?? null,
      body.driverId ?? null,
      now()
    );
    logActivity(company, auth(req).id, 'whatsapp_message_imported', 'whatsapp', id);
    notify(company, auth(req).id, 'whatsapp', 'Mensagem importada', `${body.fromNumber}: ${body.body.slice(0, 70)}`);
    res.status(201).json({ id });
  })
);

whatsappRoutes.patch(
  '/messages/:id',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        occurrenceId: z.string().nullable().optional(),
        driverId: z.string().nullable().optional(),
        processed: z.boolean().optional()
      })
      .parse(req.body);
    const message = one<{ id: string }>(
      'SELECT id FROM whatsapp_messages WHERE id = ? AND company_id = ?',
      req.params.id,
      companyId(req)
    );
    if (!message) fail(404, 'Mensagem não encontrada.');
    const fields: string[] = [];
    const values: any[] = [];
    if ('occurrenceId' in body) {
      fields.push('occurrence_id = ?');
      values.push(body.occurrenceId);
    }
    if ('driverId' in body) {
      fields.push('driver_id = ?');
      values.push(body.driverId);
    }
    if (body.processed !== undefined) {
      fields.push('processed = ?');
      values.push(body.processed ? 1 : 0);
    }
    if (fields.length) run(`UPDATE whatsapp_messages SET ${fields.join(', ')} WHERE id = ?`, ...values, message.id);
    res.json({ ok: true });
  })
);

whatsappRoutes.post(
  '/send',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ to: z.string().min(4), message: z.string().min(1), occurrenceId: z.string().nullable().optional() }).parse(req.body);
    const company = companyId(req);
    const waId = await sendWhatsAppText(body.to, body.message);
    run(
      `INSERT INTO whatsapp_messages (id, company_id, wa_message_id, direction, from_number, to_number, body, occurred_at, occurrence_id, processed, created_at)
       VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 1, ?)`,
      newId(),
      company,
      waId,
      config.whatsapp.phoneNumberId || null,
      body.to,
      body.message,
      now(),
      body.occurrenceId ?? null,
      now()
    );
    markWhatsappSync(company);
    logActivity(company, auth(req).id, 'whatsapp_message_sent', 'whatsapp', waId, { to: body.to });
    res.json({ ok: true, waMessageId: waId });
  })
);

webhookRoutes.get('/', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  if (!config.whatsapp.verifyToken) {
    res.status(503).json({ error: 'WHATSAPP_VERIFY_TOKEN não configurado.' });
    return;
  }
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  res.status(403).json({ error: 'Verificação de webhook inválida.' });
});

webhookRoutes.post(
  '/',
  asyncRoute(async (req, res) => {
    if (!verifyWebhookSignature((req as any).rawBody, req.header('x-hub-signature-256') || undefined)) {
      res.status(401).json({ error: 'Assinatura do webhook inválida ou APP_SECRET não configurado.' });
      return;
    }
    const company = one<{ id: string }>('SELECT id FROM companies LIMIT 1');
    if (!company) {
      res.status(503).json({ error: 'Nenhuma empresa configurada.' });
      return;
    }
    const payload = req.body as { entry?: Array<{ changes?: Array<{ field?: string; value?: any }> }> };
    let processed = 0;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages' || !change.value?.messages) continue;
        const contacts = change.value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined;
        for (const message of change.value.messages as Array<any>) {
          const waMessageId = message.id ? String(message.id) : null;
          if (!waMessageId) continue;
          const duplicate = one<{ id: string }>(
            'SELECT id FROM whatsapp_messages WHERE company_id = ? AND wa_message_id = ?',
            company.id,
            waMessageId
          );
          if (duplicate) continue;
          const from = String(message.from || '');
          const contact = contacts?.find((item) => item.wa_id === from);
          const text =
            message.text?.body ||
            message.button?.text ||
            message.interactive?.button_reply?.title ||
            message.interactive?.list_reply?.title ||
            '[mídia recebida]';
          const occurredAt = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : now();
          const id = newId();
          run(
            `INSERT INTO whatsapp_messages (id, company_id, wa_message_id, direction, from_number, body, occurred_at, processed, raw, created_at)
             VALUES (?, ?, ?, 'inbound', ?, ?, ?, 0, ?, ?)`,
            id,
            company.id,
            waMessageId,
            from,
            String(text),
            occurredAt,
            JSON.stringify(message),
            now()
          );
          const users = all<{ id: string }>('SELECT id FROM users WHERE company_id = ?', company.id);
          for (const user of users) {
            notify(company.id, user.id, 'whatsapp', 'Nova mensagem WhatsApp', `${contact?.profile?.name || from}: ${String(text).slice(0, 70)}`);
          }
          processed += 1;
        }
      }
    }
    markWhatsappSync(company.id);
    res.json({ received: true, processed });
  })
);

whatsappRoutes.use((error: unknown, req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  if (error instanceof IntegrationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  errorHandler(error, req, res, next);
});
