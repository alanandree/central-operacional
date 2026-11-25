import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';
import { getSetting, now, one, run } from './db.ts';

export class IntegrationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function whatsappConfigured(): boolean {
  return Boolean(config.whatsapp.accessToken && config.whatsapp.phoneNumberId);
}

export function whatsappStatus(companyId: string) {
  const row = one<{ status: string; display_number: string | null; last_sync_at: string | null; notes: string | null }>(
    'SELECT status, display_number, last_sync_at, notes FROM whatsapp_integrations WHERE company_id = ? AND provider = ?',
    companyId,
    'cloud_api'
  );
  const missing: string[] = [];
  if (!config.whatsapp.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!config.whatsapp.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!config.whatsapp.businessAccountId) missing.push('WHATSAPP_BUSINESS_ACCOUNT_ID');
  if (!config.whatsapp.verifyToken) missing.push('WHATSAPP_VERIFY_TOKEN');
  if (!config.appSecret) missing.push('APP_SECRET');
  const configured = whatsappConfigured();
  const groupSupport = getSetting<'unknown' | 'yes' | 'no'>(companyId, 'whatsapp_group_support', 'unknown');
  return {
    provider: 'WhatsApp Business Cloud API',
    configured,
    verified: row?.status === 'verified',
    status: configured ? (row?.status === 'verified' ? 'verified' : 'credentials_present') : 'not_configured',
    displayNumber: row?.display_number ?? null,
    lastSyncAt: row?.last_sync_at ?? null,
    notes: row?.notes ?? null,
    missing,
    webhookUrl: '/api/webhooks/whatsapp',
    groupSupport,
    canReadGroups: groupSupport === 'yes',
    officialOnly: true
  };
}

export function markWhatsappSync(companyId: string): void {
  run(
    'UPDATE whatsapp_integrations SET status = ?, last_sync_at = ?, updated_at = ? WHERE company_id = ? AND provider = ?',
    whatsappConfigured() ? 'credentials_present' : 'not_configured',
    now(),
    now(),
    companyId,
    'cloud_api'
  );
}

export function verifyWebhookSignature(raw: Buffer | undefined, signature: string | undefined): boolean {
  if (!config.appSecret || !raw || !signature || !signature.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', config.appSecret).update(raw).digest('hex');
  const received = signature.slice(7);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}

export async function sendWhatsAppText(to: string, body: string): Promise<string> {
  if (!whatsappConfigured()) {
    throw new IntegrationError(503, 'WhatsApp não configurado. Preencha WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID no .env.');
  }
  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: { message?: string } }).error?.message ?? `Falha na API (${response.status}).`;
    throw new IntegrationError(502, message);
  }
  const messageId = (data as { messages?: Array<{ id?: string }> }).messages?.[0]?.id;
  if (!messageId) throw new IntegrationError(502, 'A API do WhatsApp não devolveu o ID da mensagem enviada.');
  return String(messageId);
}

export function aiConfigured(): boolean {
  return Boolean(config.ai.apiKey);
}

export function aiStatus() {
  return {
    configured: aiConfigured(),
    provider: config.ai.apiKey ? 'API compatível com OpenAI' : 'não configurada',
    model: config.ai.apiKey ? config.ai.model : null,
    capabilities: [
      'classificação de ocorrências',
      'extração de campos',
      'sugestão de categoria e prioridade',
      'resumo de histórico',
      'sugestão de resposta',
      'ocorrências semelhantes',
      'relatórios em linguagem natural'
    ]
  };
}

async function callAI(system: string, user: string, json: boolean): Promise<string> {
  if (!aiConfigured()) {
    throw new IntegrationError(503, 'IA não configurada. Defina OPENAI_API_KEY no .env para ativar.');
  }
  const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.ai.model,
      temperature: 0.2,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: { message?: string } }).error?.message ?? `Falha na API de IA (${response.status}).`;
    throw new IntegrationError(502, message);
  }
  const content = (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
  if (!content) throw new IntegrationError(502, 'A API de IA não retornou conteúdo.');
  return content.trim();
}

export async function callAIJson<T>(system: string, user: string): Promise<T> {
  const content = await callAI(system, user, true);
  const cleaned = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new IntegrationError(502, 'A IA retornou um JSON inválido.');
  }
}

export async function callAIText(system: string, user: string): Promise<string> {
  return callAI(system, user, false);
}

export async function sendResetEmail(to: string, token: string): Promise<{ sent: boolean; reason?: string }> {
  if (!config.resendApiKey) return { sent: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  const appUrl = config.appUrl;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Central Operacional <onboarding@resend.dev>',
      to: [to],
      subject: 'Recuperação de senha - Central Operacional',
      html: `<p>Use o link abaixo para redefinir sua senha:</p><p><a href="${appUrl}/reset-password?token=${encodeURIComponent(token)}">Redefinir senha</a></p><p>Este link expira em 30 minutos.</p>`
    })
  });
  if (!response.ok) throw new IntegrationError(502, 'Falha ao enviar e-mail de recuperação.');
  return { sent: true };
}

export async function verifyWhatsappCredentials(companyId: string): Promise<{ verified: boolean; displayNumber: string | null }> {
  if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) {
    throw new IntegrationError(503, 'Credenciais do WhatsApp incompletas.');
  }
  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}?fields=verified_name,display_phone_number`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({})) as { display_phone_number?: string; error?: { message?: string } };
  if (!response.ok) throw new IntegrationError(502, data.error?.message ?? 'Não foi possível validar as credenciais do WhatsApp.');
  const displayNumber = data.display_phone_number ?? null;
  run(
    'UPDATE whatsapp_integrations SET status = ?, display_number = ?, last_sync_at = ?, updated_at = ? WHERE company_id = ? AND provider = ?',
    'verified',
    displayNumber,
    now(),
    now(),
    companyId,
    'cloud_api'
  );
  return { verified: true, displayNumber };
}

export async function downloadWhatsappMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string; filename: string }> {
  if (!config.whatsapp.accessToken) throw new IntegrationError(503, 'WhatsApp não configurado.');
  const metaResponse = await fetch(`https://graph.facebook.com/${config.whatsapp.apiVersion}/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    signal: AbortSignal.timeout(20000)
  });
  const meta = await metaResponse.json().catch(() => ({})) as {
    url?: string;
    mime_type?: string;
    filename?: string;
    error?: { message?: string };
  };
  if (!metaResponse.ok || !meta.url) throw new IntegrationError(502, meta.error?.message ?? 'Não foi possível localizar a mídia no WhatsApp.');
  const fileResponse = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    signal: AbortSignal.timeout(30000)
  });
  if (!fileResponse.ok) throw new IntegrationError(502, 'Não foi possível baixar a mídia do WhatsApp.');
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) throw new IntegrationError(413, 'Mídia maior que o limite permitido.');
  return {
    buffer,
    mime: meta.mime_type || fileResponse.headers.get('content-type') || 'application/octet-stream',
    filename: meta.filename || `midia-${mediaId}`
  };
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  language = 'pt_BR'
): Promise<string> {
  if (!whatsappConfigured()) throw new IntegrationError(503, 'WhatsApp não configurado.');
  const response = await fetch(`https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: language } }
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({})) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) throw new IntegrationError(502, data.error?.message ?? 'Falha ao enviar template.');
  const messageId = data.messages?.[0]?.id;
  if (!messageId) throw new IntegrationError(502, 'A API do WhatsApp não devolveu o ID do template enviado.');
  return messageId;
}
