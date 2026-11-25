import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, MessageCircle, RefreshCw, Send, Upload } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { Occurrence, WhatsappStatus } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Textarea } from '../components/ui';

interface Message {
  id: string;
  wa_message_id: string | null;
  direction: 'inbound' | 'outbound';
  from_number: string | null;
  to_number: string | null;
  body: string | null;
  occurred_at: string;
  occurrence_id: string | null;
  processed: number;
}

export function WhatsAppPage() {
  const { toast } = useApp();
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [displayNumber, setDisplayNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [importData, setImportData] = useState({ fromNumber: '', body: '', occurrenceId: '' });
  const [sendData, setSendData] = useState({ to: '', message: '', occurrenceId: '' });

  const load = async () => {
    try {
      const [statusData, messageData, occurrenceData] = await Promise.all([
        api<WhatsappStatus>('/whatsapp/status'),
        api<{ messages: Message[] }>('/whatsapp/messages?limit=100'),
        api<{ items: Occurrence[] }>('/occurrences?limit=100')
      ]);
      setStatus(statusData);
      setDisplayNumber(statusData.displayNumber ?? '');
      setNotes(statusData.notes ?? '');
      setMessages(messageData.messages);
      setOccurrences(occurrenceData.items);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar WhatsApp.', 'error');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveConfig = async () => {
    try {
      await api('/whatsapp/config', { method: 'POST', body: JSON.stringify({ displayNumber: displayNumber || null, notes: notes || null }) });
      toast('Configuração salva.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao salvar.', 'error');
    }
  };

  const importMessage = async () => {
    try {
      await api('/whatsapp/messages/import', {
        method: 'POST',
        body: JSON.stringify({ fromNumber: importData.fromNumber, body: importData.body, occurrenceId: importData.occurrenceId || null })
      });
      toast('Mensagem importada.');
      setImportData({ fromNumber: '', body: '', occurrenceId: '' });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao importar.', 'error');
    }
  };

  const sendMessage = async () => {
    try {
      await api('/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({ to: sendData.to, message: sendData.message, occurrenceId: sendData.occurrenceId || null })
      });
      toast('Mensagem enviada.');
      setSendData({ ...sendData, message: '' });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao enviar.', 'error');
    }
  };

  const markProcessed = async (message: Message) => {
    try {
      await api(`/whatsapp/messages/${message.id}`, { method: 'PATCH', body: JSON.stringify({ processed: message.processed ? false : true }) });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao atualizar.', 'error');
    }
  };

  if (!status) return null;

  return (
    <div>
      <PageHeader
        title="WhatsApp"
        description="Central de mensagens com WhatsApp Business Cloud API."
        actions={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Atualizar</Button>}
      />

      <Card className="mb-6">
        <CardHeader
          title="Status da integração"
          description="A aplicação usa apenas a API oficial da Meta."
          action={<Badge tone={status.configured ? 'success' : 'warning'}>{status.configured ? 'Conectado' : 'Não configurado'}</Badge>}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-[11px] uppercase text-muted">Provedor</p><p className="mt-1 text-sm text-ink">{status.provider}</p></div>
          <div><p className="text-[11px] uppercase text-muted">Número</p><p className="mt-1 text-sm text-ink">{status.displayNumber || 'Não informado'}</p></div>
          <div><p className="text-[11px] uppercase text-muted">Última sincronização</p><p className="mt-1 text-sm text-ink">{formatDate(status.lastSyncAt)}</p></div>
          <div><p className="text-[11px] uppercase text-muted">Grupos</p><p className="mt-1 text-sm text-ink">{status.groupSupport === 'yes' ? 'Suporte confirmado' : status.groupSupport === 'no' ? 'Sem suporte' : 'Não verificado'}</p></div>
        </div>
        {!status.configured && (
          <div className="mx-5 mb-5 flex gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <div className="text-xs text-muted">
              <p className="font-medium text-warning">Integração desativada até configurar credenciais.</p>
              <p className="mt-1">Variáveis ausentes: {status.missing.join(', ') || 'nenhuma'}.</p>
              <p className="mt-1">Nenhuma conexão ou envio é simulado. Você ainda pode importar mensagens manualmente.</p>
            </div>
          </div>
        )}
        <div className="border-t border-line p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
            <Field label="Número exibido"><Input value={displayNumber} onChange={(event) => setDisplayNumber(event.target.value)} placeholder="+55 11 99999-9999" /></Field>
            <Field label="Observações"><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: grupo de ocorrências" /></Field>
            <div className="flex items-end"><Button variant="primary" onClick={() => void saveConfig()}>Salvar</Button></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <span>Webhook: <code className="rounded bg-canvas px-2 py-1">{status.webhookUrl}</code></span>
            <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}${status.webhookUrl}`); toast('URL copiada.', 'info'); }}><Copy className="h-3.5 w-3.5" /> Copiar URL</Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Importar mensagem" description="Use quando o grupo não puder ser lido pela API" />
          <div className="space-y-4 p-5">
            <Field label="Remetente"><Input value={importData.fromNumber} onChange={(event) => setImportData({ ...importData, fromNumber: event.target.value })} placeholder="5511999999999" /></Field>
            <Field label="Mensagem"><Textarea value={importData.body} onChange={(event) => setImportData({ ...importData, body: event.target.value })} /></Field>
            <Field label="Vincular à ocorrência">
              <Select value={importData.occurrenceId} onChange={(event) => setImportData({ ...importData, occurrenceId: event.target.value })}>
                <option value="">Nenhuma</option>
                {occurrences.map((item) => <option key={item.id} value={item.id}>{item.code} • {item.customerName}</option>)}
              </Select>
            </Field>
            <Button variant="primary" onClick={() => void importMessage()} disabled={!importData.fromNumber || !importData.body}><Upload className="h-4 w-4" /> Importar</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Enviar mensagem" description={status.configured ? 'Envio real pela Cloud API' : 'Desativado sem credenciais'} />
          <div className="space-y-4 p-5">
            <Field label="Destinatário"><Input value={sendData.to} onChange={(event) => setSendData({ ...sendData, to: event.target.value })} placeholder="5511999999999" /></Field>
            <Field label="Mensagem"><Textarea value={sendData.message} onChange={(event) => setSendData({ ...sendData, message: event.target.value })} /></Field>
            <Field label="Ocorrência">
              <Select value={sendData.occurrenceId} onChange={(event) => setSendData({ ...sendData, occurrenceId: event.target.value })}>
                <option value="">Nenhuma</option>
                {occurrences.map((item) => <option key={item.id} value={item.id}>{item.code} • {item.customerName}</option>)}
              </Select>
            </Field>
            <Button variant="primary" onClick={() => void sendMessage()} disabled={!status.configured || !sendData.to || !sendData.message}>
              <Send className="h-4 w-4" /> Enviar
            </Button>
            {!status.configured && <p className="text-[11px] text-warning">Preencha as variáveis de ambiente e reinicie o servidor para habilitar.</p>}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Mensagens" description={`${messages.length} mensagem(ns) registrada(s)`} />
        <div className="divide-y divide-line/60">
          {messages.length === 0 ? (
            <EmptyState icon={<MessageCircle className="h-5 w-5" />} title="Nenhuma mensagem" description="Mensagens recebidas pelo webhook ou importadas manualmente aparecem aqui." />
          ) : (
            messages.map((message) => (
              <div key={message.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={message.direction === 'inbound' ? 'info' : 'success'}>{message.direction === 'inbound' ? 'Recebida' : 'Enviada'}</Badge>
                    <span className="text-xs text-ink">{message.direction === 'inbound' ? message.from_number : message.to_number}</span>
                    {message.processed ? <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3" />Processada</Badge> : <Badge tone="warning">Pendente</Badge>}
                  </div>
                  <span className="text-[11px] text-muted">{formatDate(message.occurred_at)}</span>
                </div>
                <p className="mt-2 text-sm text-muted">{message.body}</p>
                <div className="mt-3 flex gap-2">
                  {message.occurrence_id && <Badge tone="info">Ocorrência vinculada</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => void markProcessed(message)}>{message.processed ? 'Marcar pendente' : 'Marcar processada'}</Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
