import { addDriverHistory, all, db, getSetting, newId, notifyAdmins, now, one, parseJson, run } from './db.ts';
import { fail } from './core.ts';
import { createPendingDriver } from './routes/drivers.ts';
import { sendWhatsAppTemplate, sendWhatsAppText, whatsappConfigured } from './integrations.ts';
import { saveBufferFile } from './upload.ts';

export interface RegistrationMedia {
  buffer: Buffer;
  filename: string;
  mime: string;
}

export interface RegistrationMessage {
  id: string;
  from: string;
  text: string;
  occurredAt: string;
  media?: RegistrationMedia;
}

interface FlowRow {
  id: string;
  step: string;
  data: string;
  status: string;
  driver_id: string | null;
}

interface FlowData {
  name?: string;
  cpf?: string;
  phone?: string;
  address?: string;
  cnhNumber?: string;
  cnhExpiry?: string;
  documents?: string[];
  consent?: boolean;
}

const adminId = (company: string) => one<{ id: string }>(
  'SELECT id FROM users WHERE company_id = ? AND role = ? ORDER BY created_at LIMIT 1',
  company,
  'admin'
)?.id ?? '';

function flowFor(company: string, phone: string): FlowRow | undefined {
  return one<FlowRow>(
    "SELECT id, step, data, status, driver_id FROM driver_registration_flows WHERE company_id = ? AND phone = ? AND status = 'pendente' ORDER BY updated_at DESC LIMIT 1",
    company,
    phone
  );
}

function updateFlow(company: string, flow: FlowRow, patch: Partial<FlowRow>): void {
  run(
    'UPDATE driver_registration_flows SET step = ?, data = ?, status = ?, driver_id = ?, updated_at = ? WHERE id = ? AND company_id = ?',
    patch.step ?? flow.step,
    patch.data ?? flow.data,
    patch.status ?? flow.status,
    patch.driver_id ?? flow.driver_id,
    now(),
    flow.id,
    company
  );
}

function withinWindow(company: string, phone: string): boolean {
  const last = one<{ occurred_at: string }>(
    "SELECT occurred_at FROM whatsapp_messages WHERE company_id = ? AND from_number = ? AND direction = 'inbound' ORDER BY occurred_at DESC LIMIT 1",
    company,
    phone
  );
  if (!last) return false;
  return Date.now() - new Date(last.occurred_at).getTime() <= 24 * 60 * 60 * 1000;
}

function reply(company: string, phone: string, text: string, occurrenceId: string | null = null): void {
  if (!whatsappConfigured()) return;
  try {
    const waId = withinWindow(company, phone)
      ? sendWhatsAppText(phone, text)
      : sendWhatsAppTemplate(phone, getSetting<string>(company, 'whatsapp_registration_template', 'central_driver_registration'));
    Promise.resolve(waId)
      .then((id) => {
        run(
          `INSERT INTO whatsapp_messages (id, company_id, wa_message_id, direction, from_number, to_number, body, occurred_at, occurrence_id, processed, processing_status, created_at)
           VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 1, 'enviada', ?)`,
          newId(), company, id, one<{ phone_number_id: string }>('SELECT phone_number_id FROM whatsapp_integrations WHERE company_id = ? LIMIT 1', company)?.phone_number_id ?? null,
          phone, text, now(), occurrenceId, now()
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Falha ao responder fluxo de cadastro.';
        notifyAdmins(company, 'Falha no WhatsApp', message);
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao responder fluxo de cadastro.';
    notifyAdmins(company, 'Falha no WhatsApp', message);
  }
}

function normalizeCnhExpiry(value: string): string | null {
  const match = value.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function documentType(text: string, index: number): string {
  const lower = text.toLowerCase();
  if (/resid|comprovante de endere|conta de luz|conta de agua/.test(lower)) return 'Comprovante de residência';
  if (/cnh|habilita/.test(lower)) return 'CNH';
  if (/rg|identidade/.test(lower)) return 'RG';
  return index === 0 ? 'CNH' : 'Comprovante de residência';
}

function attachDocument(company: string, flow: FlowRow, data: FlowData, message: RegistrationMessage): boolean {
  if (!message.media || !flow.driver_id) return false;
  const userId = adminId(company);
  const file = saveBufferFile(company, userId, {
    buffer: message.media.buffer,
    filename: message.media.filename,
    mime: message.media.mime
  });
  const type = documentType(message.text, data.documents?.length ?? 0);
  const expiry = type === 'CNH' ? data.cnhExpiry ?? null : null;
  run(
    `INSERT INTO driver_documents (id, company_id, driver_id, type, file_id, expiry_date, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?)`,
    newId(), company, flow.driver_id, type, file.id, expiry, 'Documento enviado via WhatsApp', now()
  );
  addDriverHistory(company, flow.driver_id, userId, 'Documento recebido via WhatsApp', type);
  data.documents = [...(data.documents ?? []), type];
  updateFlow(company, flow, { data: JSON.stringify(data) });
  if (data.documents.length >= 2) {
    updateFlow(company, flow, { status: 'concluida' });
    notifyAdmins(company, 'Cadastro concluído', `${data.name || 'Motorista'} enviou os documentos via WhatsApp.`);
    reply(company, message.from, 'Recebemos seus documentos. Nossa equipe vai revisar e retornar.');
  } else {
    reply(company, message.from, 'Recebido. Envie agora o comprovante de residência.');
  }
  return true;
}

export function handleRegistrationMessage(company: string, message: RegistrationMessage): boolean {
  const lower = message.text.trim().toLowerCase();
  let flow = flowFor(company, message.from);
  if (!flow) {
    if (!/cadastro|cadastrar|quero ser motorista|trabalhar como motorista/.test(lower)) return false;
    const id = newId();
    run(
      'INSERT INTO driver_registration_flows (id, company_id, phone, step, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, company, message.from, 'consent', JSON.stringify({ consent: false } satisfies FlowData), 'pendente', now(), now()
    );
    flow = { id, step: 'consent', data: JSON.stringify({ consent: false } satisfies FlowData), status: 'pendente', driver_id: null };
    reply(company, message.from, 'Para cadastrar seus dados e documentos, você concorda com o uso deles apenas para fins de recrutamento e gestão operacional? Responda SIM ou NÃO.');
    return true;
  }
  if (/cancelar|desistir|não quero|nao quero/.test(lower) && flow.step !== 'documents') {
    updateFlow(company, flow, { status: 'cancelada' });
    reply(company, message.from, 'Cadastro cancelado. Nenhum dado foi salvo.');
    return true;
  }
  const data = parseJson<FlowData>(flow.data, {});
  if (flow.step === 'consent') {
    if (!/^(sim|s|aceito|concordo|ok|pode)$/.test(lower)) {
      updateFlow(company, flow, { status: 'cancelada' });
      reply(company, message.from, 'Entendido. Para prosseguir precisamos do seu consentimento. Cadastro encerrado.');
      return true;
    }
    data.consent = true;
    updateFlow(company, flow, { step: 'name', data: JSON.stringify(data) });
    reply(company, message.from, 'Ótimo. Qual é o seu nome completo?');
    return true;
  }
  if (flow.step === 'name') {
    if (message.text.trim().length < 3) {
      reply(company, message.from, 'Informe seu nome completo.');
      return true;
    }
    data.name = message.text.trim();
    updateFlow(company, flow, { step: 'cpf', data: JSON.stringify(data) });
    reply(company, message.from, 'Agora informe seu CPF (somente números).');
    return true;
  }
  if (flow.step === 'cpf') {
    const cpf = message.text.replace(/\D/g, '');
    if (cpf.length !== 11) {
      reply(company, message.from, 'CPF inválido. Informe os 11 números.');
      return true;
    }
    const exists = one<{ id: string }>('SELECT id FROM drivers WHERE company_id = ? AND cpf = ?', company, cpf);
    if (exists) {
      updateFlow(company, flow, { status: 'cancelada' });
      reply(company, message.from, 'Já existe motorista cadastrado com este CPF. Procure a central para atualizar seus dados.');
      return true;
    }
    data.cpf = cpf;
    updateFlow(company, flow, { step: 'phone', data: JSON.stringify(data) });
    reply(company, message.from, 'Informe um telefone de contato.');
    return true;
  }
  if (flow.step === 'phone') {
    data.phone = message.text.trim();
    updateFlow(company, flow, { step: 'address', data: JSON.stringify(data) });
    reply(company, message.from, 'Informe seu endereço completo (rua, número, bairro, cidade e UF).');
    return true;
  }
  if (flow.step === 'address') {
    data.address = message.text.trim();
    updateFlow(company, flow, { step: 'cnh', data: JSON.stringify(data) });
    reply(company, message.from, 'Informe o número da CNH e a validade no formato DD/MM/AAAA. Ex.: 12345678900, 10/05/2028');
    return true;
  }
  if (flow.step === 'cnh') {
    const cnh = message.text.match(/\b([A-Z0-9]{9,12})\b/i)?.[1];
    const expiry = normalizeCnhExpiry(message.text);
    if (!cnh || !expiry) {
      reply(company, message.from, 'Não consegui ler a CNH. Envie no formato: número, DD/MM/AAAA.');
      return true;
    }
    data.cnhNumber = cnh;
    data.cnhExpiry = expiry;
    const driverId = createPendingDriver(company, adminId(company), {
      name: data.name ?? 'Motorista via WhatsApp',
      cpf: data.cpf ?? '',
      phone: data.phone ?? message.from,
      address: data.address ?? null,
      cnhNumber: cnh,
      cnhExpiry: expiry,
      notes: 'Pré-cadastro via WhatsApp'
    });
    updateFlow(company, flow, { step: 'documents', driver_id: driverId, data: JSON.stringify(data) });
    reply(company, message.from, 'Dados salvos. Envie a foto da CNH e, em seguida, o comprovante de residência. Você pode escrever o tipo do documento na legenda.');
    return true;
  }
  if (flow.step === 'documents') {
    if (!attachDocument(company, flow, data, message)) {
      reply(company, message.from, 'Envie a foto do documento com a legenda indicando CNH ou comprovante de residência.');
    }
    return true;
  }
  return true;
}

export function pendingRegistrationFlows(company: string) {
  return all<any>(
    'SELECT id, phone, step, status, driver_id, created_at, updated_at FROM driver_registration_flows WHERE company_id = ? ORDER BY updated_at DESC',
    company
  );
}

export function cancelRegistrationFlow(company: string, id: string): void {
  const flow = one<{ id: string }>(
    "SELECT id FROM driver_registration_flows WHERE id = ? AND company_id = ? AND status = 'pendente'",
    id,
    company
  );
  if (!flow) fail(404, 'Fluxo não encontrado ou já encerrado.');
  run('UPDATE driver_registration_flows SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?', 'cancelada', now(), id, company);
}

export function registrationAdminId(company: string): string {
  return adminId(company);
}

export function registrationFlowMessageId(company: string, phone: string): string | null {
  const row = db.prepare(
    "SELECT id FROM whatsapp_messages WHERE company_id = ? AND from_number = ? AND direction = 'inbound' ORDER BY occurred_at DESC LIMIT 1"
  ).get(company, phone) as { id: string } | undefined;
  return row?.id ?? null;
}
