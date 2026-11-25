import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, auth, authRequired, companyId, errorHandler, fail, pagination } from '../core.ts';
import { all, db, logActivity, newId, notify, notifyAdmins, now, one, run } from '../db.ts';
import { config } from '../config.ts';
import { rateLimit } from '../security.ts';
import { saveBufferFile } from '../upload.ts';
import {
  IntegrationError, downloadWhatsappMedia, markWhatsappSync, sendWhatsAppTemplate, sendWhatsAppText,
  verifyWhatsappCredentials, verifyWebhookSignature, whatsappConfigured, whatsappStatus
} from '../integrations.ts';
import { analyzeMessage, formatSuggestion, getSuggestion, saveSuggestion } from '../triage.ts';
import { cancelRegistrationFlow, handleRegistrationMessage, pendingRegistrationFlows } from '../registration.ts';

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
  '/verify',
  authRequired,
  rateLimit({ key: 'whatsapp-verify', max: 10, windowMs: 60_000 }),
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const result = await verifyWhatsappCredentials(company);
    run(
      'UPDATE whatsapp_integrations SET status = ?, last_sync_at = ?, updated_at = ? WHERE company_id = ? AND provider = ?',
      'connected', now(), now(), company, 'cloud_api'
    );
    markWhatsappSync(company);
    logActivity(company, auth(req).id, 'whatsapp_credentials_verified', 'whatsapp', company);
    res.json(result);
  })
);

whatsappRoutes.post(
  '/config',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        displayNumber: z.string().max(40).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        registrationTemplate: z.string().max(80).optional()
      })
      .parse(req.body);
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
    if (body.registrationTemplate) {
      run(
        'INSERT INTO settings (id, company_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        newId(), company, 'whatsapp_registration_template', JSON.stringify(body.registrationTemplate), now()
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
    const company = companyId(req);
    const { limit, offset } = pagination(req);
    const conditions = ['m.company_id = ?'];
    const params: any[] = [company];
    if (req.query.occurrenceId) {
      conditions.push('m.occurrence_id = ?');
      params.push(String(req.query.occurrenceId));
    }
    if (req.query.fromNumber) {
      conditions.push('m.from_number LIKE ?');
      params.push(`%${String(req.query.fromNumber)}%`);
    }
    if (req.query.direction === 'inbound' || req.query.direction === 'outbound') {
      conditions.push('m.direction = ?');
      params.push(req.query.direction);
    }
    if (req.query.processed === '0' || req.query.processed === '1') {
      conditions.push('m.processed = ?');
      params.push(Number(req.query.processed));
    }
    if (req.query.processingStatus) {
      conditions.push('m.processing_status = ?');
      params.push(String(req.query.processingStatus));
    }
    if (req.query.hasMedia === '1') conditions.push('m.media_file_id IS NOT NULL');
    if (req.query.from) {
      conditions.push('m.occurred_at >= ?');
      params.push(new Date(String(req.query.from)).toISOString());
    }
    if (req.query.to) {
      conditions.push('m.occurred_at <= ?');
      params.push(new Date(String(req.query.to)).toISOString());
    }
    const search = String(req.query.search || '').trim();
    if (search) {
      conditions.push('(m.body LIKE ? OR m.from_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = conditions.join(' AND ');
    const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM whatsapp_messages m WHERE ${where}`, ...params)?.total ?? 0;
    const messages = all<any>(
      `SELECT m.id, m.wa_message_id, m.direction, m.from_number, m.to_number, m.contact_name, m.body,
              m.occurred_at, m.occurrence_id, m.driver_id, m.processed, m.processing_status,
              m.media_file_id, m.media_mime, m.media_name,
              (SELECT COUNT(*) FROM ai_suggestions s WHERE s.message_id = m.id) AS suggestion_count,
              o.number AS occurrence_number, o.status AS occurrence_status
       FROM whatsapp_messages m LEFT JOIN occurrences o ON o.id = m.occurrence_id
       WHERE ${where} ORDER BY m.occurred_at DESC LIMIT ${limit} OFFSET ${offset}`,
      ...params
    );
    res.json({
      messages: messages.map((item) => ({
        ...item,
        waMessageId: item.wa_message_id,
        fromNumber: item.from_number,
        toNumber: item.to_number,
        contactName: item.contact_name,
        occurredAt: item.occurred_at,
        occurrenceId: item.occurrence_id,
        driverId: item.driver_id,
        processingStatus: item.processing_status,
        mediaFileId: item.media_file_id,
        mediaMime: item.media_mime,
        mediaName: item.media_name,
        suggestionCount: Number(item.suggestion_count) || 0,
        occurrenceNumber: item.occurrence_number ?? null,
        occurrenceStatus: item.occurrence_status ?? null
      })),
      total,
      limit,
      offset
    });
  })
);

whatsappRoutes.get(
  '/conversations',
  authRequired,
  asyncRoute(async (req, res) => {
    const company = companyId(req);
    const rows = all<any>(
      `SELECT m.from_number AS phone,
              MAX(m.occurred_at) AS lastAt,
              (SELECT body FROM whatsapp_messages x WHERE x.company_id = m.company_id AND x.from_number = m.from_number ORDER BY x.occurred_at DESC LIMIT 1) AS lastBody,
              (SELECT COUNT(*) FROM whatsapp_messages x WHERE x.company_id = m.company_id AND x.from_number = m.from_number AND x.direction = 'inbound' AND x.processed = 0) AS pendingCount,
              (SELECT COUNT(*) FROM ai_suggestions s WHERE s.company_id = m.company_id AND s.status = 'pendente' AND s.message_id IN (SELECT id FROM whatsapp_messages x WHERE x.company_id = m.company_id AND x.from_number = m.from_number)) AS pendingSuggestions,
              (SELECT name FROM drivers d WHERE d.company_id = m.company_id AND d.phone = m.from_number LIMIT 1) AS driverName
       FROM whatsapp_messages m
       WHERE m.company_id = ? AND m.direction = 'inbound' AND m.from_number IS NOT NULL
       GROUP BY m.from_number
       ORDER BY lastAt DESC`,
      company
    );
    res.json({ conversations: rows });
  })
);

whatsappRoutes.post(
  '/messages/import',
  authRequired,
  rateLimit({ key: 'whatsapp-import', max: 60, windowMs: 60_000 }),
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        fromNumber: z.string().min(4).max(40),
        body: z.string().min(1).max(8000),
        occurredAt: z.string().optional(),
        occurrenceId: z.string().nullable().optional(),
        driverId: z.string().nullable().optional()
      })
      .parse(req.body);
    const company = companyId(req);
    const occurredAt = body.occurredAt ? new Date(body.occurredAt).toISOString() : now();
    if (body.occurrenceId && !one<{ id: string }>('SELECT id FROM occurrences WHERE id = ? AND company_id = ?', body.occurrenceId, company)) {
      fail(404, 'Ocorrência não encontrada.');
    }
    if (body.driverId && !one<{ id: string }>('SELECT id FROM drivers WHERE id = ? AND company_id = ?', body.driverId, company)) {
      fail(404, 'Motorista não encontrado.');
    }
    const id = newId();
    run(
      `INSERT INTO whatsapp_messages (id, company_id, direction, from_number, body, occurred_at, occurrence_id, driver_id, processed, processing_status, created_at)
       VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, 0, 'pendente', ?)`,
      id, company, body.fromNumber, body.body, occurredAt, body.occurrenceId ?? null, body.driverId ?? null, now()
    );
    const analysis = await analyzeMessage(company, body.body);
    const suggestionId = saveSuggestion(company, id, analysis);
    run('UPDATE whatsapp_messages SET processing_status = ? WHERE id = ? AND company_id = ?', analysis.isComplaint ? 'triagem_pendente' : 'sem_ocorrencia', id, company);
    logActivity(company, auth(req).id, 'whatsapp_message_imported', 'whatsapp', id, { suggestionId });
    notify(company, auth(req).id, 'whatsapp', 'Mensagem importada', `${body.fromNumber}: ${body.body.slice(0, 70)}`);
    res.status(201).json({ id, suggestionId, suggestion: formatSuggestion(getSuggestion(company, suggestionId)) });
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
        processed: z.boolean().optional(),
        processingStatus: z.string().max(40).optional()
      })
      .parse(req.body);
    const company = companyId(req);
    const message = one<{ id: string }>(
      'SELECT id FROM whatsapp_messages WHERE id = ? AND company_id = ?',
      req.params.id,
      company
    );
    if (!message) fail(404, 'Mensagem não encontrada.');
    if (body.occurrenceId && !one<{ id: string }>('SELECT id FROM occurrences WHERE id = ? AND company_id = ?', body.occurrenceId, company)) {
      fail(404, 'Ocorrência não encontrada.');
    }
    if (body.driverId && !one<{ id: string }>('SELECT id FROM drivers WHERE id = ? AND company_id = ?', body.driverId, company)) {
      fail(404, 'Motorista não encontrado.');
    }
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
    if (body.processingStatus) {
      fields.push('processing_status = ?');
      values.push(body.processingStatus);
    }
    if (fields.length) run(`UPDATE whatsapp_messages SET ${fields.join(', ')} WHERE id = ?`, ...values, message.id);
    logActivity(company, auth(req).id, 'whatsapp_message_updated', 'whatsapp', message.id, body);
    res.json({ ok: true });
  })
);

whatsappRoutes.post(
  '/send',
  authRequired,
  rateLimit({ key: 'whatsapp-send', max: 30, windowMs: 60_000 }),
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        to: z.string().min(4).max(40),
        message: z.string().min(1).max(4000).optional(),
        templateName: z.string().max(80).optional(),
        occurrenceId: z.string().nullable().optional()
      })
      .parse(req.body);
    const company = companyId(req);
    if (body.occurrenceId && !one<{ id: string }>('SELECT id FROM occurrences WHERE id = ? AND company_id = ?', body.occurrenceId, company)) {
      fail(404, 'Ocorrência não encontrada.');
    }
    const templateName = body.templateName ?? 'central_operacional_update';
    const useTemplate = Boolean(body.templateName) || !body.message;
    const waId = useTemplate
      ? await sendWhatsAppTemplate(body.to, templateName)
      : await sendWhatsAppText(body.to, body.message!);
    const text = body.message ?? `Template: ${templateName}`;
    run(
      `INSERT INTO whatsapp_messages (id, company_id, wa_message_id, direction, from_number, to_number, body, occurred_at, occurrence_id, processed, processing_status, created_at)
       VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 1, 'enviada', ?)`,
      newId(), company, waId, config.whatsapp.phoneNumberId || null, body.to, text, now(), body.occurrenceId ?? null, now()
    );
    markWhatsappSync(company);
    logActivity(company, auth(req).id, 'whatsapp_message_sent', 'whatsapp', waId, { to: body.to, template: useTemplate });
    res.json({ ok: true, waMessageId: waId });
  })
);

whatsappRoutes.get(
  '/flows',
  authRequired,
  asyncRoute(async (req, res) => {
    res.json({ flows: pendingRegistrationFlows(companyId(req)) });
  })
);

whatsappRoutes.post(
  '/flows/:id/cancel',
  authRequired,
  asyncRoute(async (req, res) => {
    cancelRegistrationFlow(companyId(req), req.params.id);
    logActivity(companyId(req), auth(req).id, 'whatsapp_registration_cancelled', 'whatsapp', req.params.id);
    res.json({ ok: true });
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
    let ignored = 0;
    for (const entry of payload.entry ?? []) {
      const metadataPhone = entry.changes?.find((change) => change.field === 'messages')?.value?.metadata?.phone_number_id;
      if (metadataPhone && config.whatsapp.phoneNumberId && String(metadataPhone) !== config.whatsapp.phoneNumberId) {
        ignored += 1;
        continue;
      }
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages' || !change.value?.messages) continue;
        const contacts = change.value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined;
        for (const message of change.value.messages as Array<any>) {
          const waMessageId = message.id ? String(message.id) : null;
          if (!waMessageId) {
            ignored += 1;
            continue;
          }
          const from = String(message.from || '');
          const contact = contacts?.find((item) => item.wa_id === from);
          const mediaInfo = extractMediaInfo(message);
          const text = mediaInfo?.caption ||
            message.text?.body ||
            message.button?.text ||
            message.interactive?.button_reply?.title ||
            message.interactive?.list_reply?.title ||
            mediaInfo?.placeholder ||
            '[mensagem sem texto]';
          const occurredAt = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : now();
          const id = newId();
          const inserted = db.prepare(
            `INSERT OR IGNORE INTO whatsapp_messages (
              id, company_id, wa_message_id, direction, from_number, body, occurred_at, contact_name, processing_status, raw, created_at
            ) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, 'pendente', ?, ?)`
          ).run(
            id, company.id, waMessageId, from, String(text), occurredAt, contact?.profile?.name ?? null,
            JSON.stringify(message), now()
          );
          if (inserted.changes === 0) {
            ignored += 1;
            continue;
          }
          let media: { buffer: Buffer; filename: string; mime: string } | undefined;
          if (mediaInfo?.mediaId) {
            try {
              const downloaded = await downloadWhatsappMedia(String(mediaInfo.mediaId));
              const file = saveBufferFile(company.id, '', downloaded);
              run(
                'UPDATE whatsapp_messages SET media_file_id = ?, media_mime = ?, media_name = ? WHERE id = ? AND company_id = ?',
                file.id, file.mime, file.name, id, company.id
              );
              media = downloaded;
            } catch (error) {
              const detail = error instanceof Error ? error.message : 'Erro desconhecido';
              run('UPDATE whatsapp_messages SET processing_status = ? WHERE id = ? AND company_id = ?', 'midia_falhou', id, company.id);
              notifyAdmins(company.id, 'Falha ao baixar mídia', `${waMessageId}: ${detail}`);
            }
          }
          const registrationMessage = {
            id,
            from,
            text: String(text),
            occurredAt,
            media
          };
          const handledAsRegistration = handleRegistrationMessage(company.id, registrationMessage);
          if (handledAsRegistration) {
            run('UPDATE whatsapp_messages SET processing_status = ?, processed = 1 WHERE id = ? AND company_id = ?', 'cadastro', id, company.id);
          } else {
            const analysis = await analyzeMessage(company.id, String(text));
            const suggestionId = saveSuggestion(company.id, id, analysis);
            run(
              'UPDATE whatsapp_messages SET processing_status = ? WHERE id = ? AND company_id = ?',
              analysis.isComplaint ? 'triagem_pendente' : 'sem_ocorrencia', id, company.id
            );
            if (contact?.profile?.name) {
              run('UPDATE whatsapp_messages SET contact_name = ? WHERE id = ? AND company_id = ?', contact.profile.name, id, company.id);
            }
            void suggestionId;
          }
          const users = all<{ id: string }>('SELECT id FROM users WHERE company_id = ?', company.id);
          for (const user of users) {
            notify(company.id, user.id, 'whatsapp', 'Nova mensagem WhatsApp', `${contact?.profile?.name || from}: ${String(text).slice(0, 70)}`);
          }
          processed += 1;
        }
      }
    }
    markWhatsappSync(company.id);
    res.json({ received: true, processed, ignored });
  })
);

function extractMediaInfo(message: any): { mediaId: string; caption?: string; filename?: string; placeholder: string } | null {
  if (message.image) {
    return { mediaId: String(message.image.id), caption: message.image.caption, placeholder: '[Imagem recebida]' };
  }
  if (message.video) {
    return { mediaId: String(message.video.id), caption: message.video.caption, filename: message.video.filename, placeholder: '[Vídeo recebido]' };
  }
  if (message.audio) {
    return { mediaId: String(message.audio.id), placeholder: '[Áudio recebido]' };
  }
  if (message.document) {
    return {
      mediaId: String(message.document.id),
      caption: message.document.caption,
      filename: message.document.filename,
      placeholder: `[Documento recebido: ${message.document.filename || 'arquivo'}]`
    };
  }
  if (message.sticker) {
    return { mediaId: String(message.sticker.id), placeholder: '[Figurinha recebida]' };
  }
  return null;
}

whatsappRoutes.use((error: unknown, req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  if (error instanceof IntegrationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  errorHandler(error, req, res, next);
});
