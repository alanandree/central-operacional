import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, MessageCircle, Paperclip, Send } from 'lucide-react';
import { api, downloadFile, formatDate, relativeTime } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { Occurrence } from '../lib/types';
import { OCCURRENCE_STATUSES } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from '../components/ui';

interface HistoryItem { id: string; action: string; details: string | null; created_at: string; user_name: string }
interface Attachment { id: string; name: string; mime: string; size: number; created_at: string }
interface Message { id: string; direction: string; from_number: string | null; body: string | null; occurred_at: string; processed: number }

export function OccurrenceDetailPage() {
  const { id } = useParams();
  const { toast } = useApp();
  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try {
      const data = await api<{ occurrence: Occurrence; history: HistoryItem[]; attachments: Attachment[]; messages: Message[] }>(`/occurrences/${id}`);
      setOccurrence(data.occurrence);
      setHistory(data.history);
      setAttachments(data.attachments);
      setMessages(data.messages);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar ocorrência.', 'error');
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (!occurrence) return <Skeleton className="h-96 w-full" />;

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await api(`/occurrences/${occurrence.id}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
      setNote('');
      toast('Observação registrada.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao salvar observação.', 'error');
    }
  };

  const uploadAttachment = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const body = new FormData();
    body.append('file', file);
    try {
      await api(`/occurrences/${occurrence.id}/attachments`, { method: 'POST', body });
      toast('Anexo enviado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao enviar arquivo.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const changeStatus = async (status: string) => {
    try {
      await api(`/occurrences/${occurrence.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast('Status atualizado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao atualizar status.', 'error');
    }
  };

  const fields: Array<[string, string | null]> = [
    ['Cliente', occurrence.customerName],
    ['Telefone', occurrence.customerPhone],
    ['Pedido', occurrence.orderCode],
    ['Rastreamento', occurrence.trackingCode],
    ['Destinatário', occurrence.recipientName],
    ['Categoria', occurrence.categoryName],
    ['Origem', occurrence.origin],
    ['Responsável', occurrence.responsible],
    ['Recebimento', formatDate(occurrence.receivedAt)],
    ['Prazo', formatDate(occurrence.dueAt)],
    ['Prioridade', occurrence.priority],
    ['Registrada por', occurrence.authorName]
  ];

  return (
    <div>
      <PageHeader
        title={occurrence.code}
        description={occurrence.customerName}
        breadcrumbs={[{ label: 'Ocorrências', to: '/ocorrencias' }, { label: occurrence.code }]}
        actions={<Link to="/ocorrencias"><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Voltar</Button></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Detalhes da ocorrência"
              action={<Badge tone={occurrence.overdue ? 'danger' : 'info'}>{occurrence.status}</Badge>}
            />
            <div className="p-5">
              <p className="text-sm leading-relaxed text-ink">{occurrence.description}</p>
              <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {fields.map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
                    <p className="mt-1 text-sm text-ink">{value || '—'}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <Field label="Alterar status">
                  <Select value={occurrence.status} onChange={(event) => void changeStatus(event.target.value)}>
                    {OCCURRENCE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Linha do tempo" description="Cada atualização fica registrada" />
            <div className="space-y-0 p-5">
              {history.length === 0 ? (
                <EmptyState title="Sem histórico" description="As atualizações aparecerão aqui." />
              ) : (
                history.map((item, index) => (
                  <div key={item.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 h-2 w-2 rounded-full bg-info" />
                      {index < history.length - 1 && <span className="w-px flex-1 bg-line" />}
                    </div>
                    <div className="pb-5">
                      <p className="text-sm font-medium text-ink">{item.action}</p>
                      {item.details && <p className="mt-0.5 text-xs text-muted">{item.details}</p>}
                      <p className="mt-1 text-[11px] text-muted">{item.user_name} • {relativeTime(item.created_at)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Observações internas" />
            <div className="space-y-3 p-5">
              <Textarea placeholder="Registre uma observação interna..." value={note} onChange={(event) => setNote(event.target.value)} />
              <div className="flex justify-end"><Button variant="primary" onClick={() => void addNote()}><Send className="h-4 w-4" /> Adicionar</Button></div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Anexos" action={<label className="cursor-pointer text-xs font-medium text-info">{uploading ? 'Enviando...' : 'Adicionar'}<input type="file" className="hidden" onChange={(event) => void uploadAttachment(event.target.files?.[0])} /></label>} />
            <div className="divide-y divide-line/60">
              {attachments.length === 0 ? (
                <EmptyState icon={<Paperclip className="h-5 w-5" />} title="Nenhum anexo" description="Envie documentos ou imagens desta ocorrência." />
              ) : (
                attachments.map((file) => (
                  <div key={file.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-ink">{file.name}</p>
                      <p className="text-[11px] text-muted">{(file.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <Button variant="ghost" size="icon" title="Baixar" onClick={() => void downloadFile(`/files/${file.id}/download`, file.name)}><Download className="h-4 w-4" /></Button>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Mensagens do WhatsApp" description={messages.length ? `${messages.length} mensagem(ns) associada(s)` : 'Nenhuma mensagem associada'} />
            <div className="max-h-96 divide-y divide-line/60 overflow-y-auto">
              {messages.length === 0 ? (
                <EmptyState icon={<MessageCircle className="h-5 w-5" />} title="Sem mensagens ligadas" description="Vincule mensagens na central WhatsApp." />
              ) : (
                messages.map((message) => (
                  <div key={message.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-info">{message.direction === 'inbound' ? message.from_number : 'Envio'}</span>
                      <span className="text-[10px] text-muted">{formatDate(message.occurred_at)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{message.body}</p>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Criada em</span>
              <span className="text-ink">{formatDate(occurrence.createdAt)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted">Última alteração</span>
              <span className="text-ink">{formatDate(occurrence.updatedAt)}</span>
            </div>
            <div className="mt-4 flex justify-center"><Badge tone={occurrence.priority === 'Urgente' ? 'danger' : 'info'}>{occurrence.priority}</Badge></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
