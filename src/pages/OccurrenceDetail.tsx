import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Clock3, Download, MessageCircle, Paperclip, Send } from 'lucide-react';
import { api, downloadFile, formatDate, relativeTime } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { Attachment, Occurrence, OccurrenceHistoryItem, OccurrenceMessage, SlaPause, SlaStatus } from '../lib/types';
import { OCCURRENCE_STATUSES } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Select, Skeleton, Textarea } from '../components/ui';

interface RawHistory {
  id: string;
  action: string;
  details: string | null;
  created_at?: string;
  createdAt?: string;
  user_name?: string | null;
  authorName?: string | null;
}

interface RawMessage {
  id: string;
  body: string | null;
  direction?: string;
  occurred_at?: string;
  createdAt?: string;
  from_number?: string | null;
  contact_name?: string | null;
  authorName?: string | null;
}

interface RawAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  created_at?: string;
  createdAt?: string;
  url?: string;
  authorName?: string | null;
}

interface RawPause {
  id: string;
  reason: string;
  paused_at?: string;
  started_at?: string;
  startedAt?: string;
  resumed_at?: string | null;
  endedAt?: string | null;
  pause_minutes?: number;
  pausedMinutes?: number;
  created_at?: string;
  user_name?: string | null;
  authorName?: string | null;
}

interface OccurrenceDetailResponse {
  occurrence: Occurrence;
  attachments: RawAttachment[];
}

function normalizeHistory(row: RawHistory): OccurrenceHistoryItem {
  return {
    id: row.id,
    action: row.action,
    details: row.details ?? null,
    createdAt: row.createdAt ?? row.created_at ?? '',
    authorName: row.authorName ?? row.user_name ?? null
  };
}

function normalizeMessage(row: RawMessage): OccurrenceMessage {
  return {
    id: row.id,
    body: row.body ?? '',
    direction: row.direction === 'inbound' ? 'inbound' : 'outbound',
    authorName: row.authorName ?? row.contact_name ?? row.from_number ?? null,
    createdAt: row.createdAt ?? row.occurred_at ?? ''
  };
}

function normalizeAttachment(row: RawAttachment): Attachment {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size) || 0,
    createdAt: row.createdAt ?? row.created_at ?? '',
    authorName: row.authorName ?? null,
    url: row.url ?? `/files/${row.id}/download`
  };
}

function normalizePause(row: RawPause): SlaPause {
  return {
    id: row.id,
    reason: row.reason,
    startedAt: row.startedAt ?? row.started_at ?? row.paused_at ?? row.created_at ?? '',
    endedAt: row.endedAt ?? row.resumed_at ?? null,
    pausedMinutes: Number(row.pausedMinutes ?? row.pause_minutes ?? 0) || 0,
    authorName: row.authorName ?? row.user_name ?? null
  };
}

function isClosedStatus(status: string): boolean {
  return status === 'Resolvida' || status === 'Encerrada';
}

function statusTone(status: string): 'neutral' | 'success' | 'info' | 'warning' {
  if (isClosedStatus(status)) return 'success';
  if (status.startsWith('Aguardando')) return 'warning';
  if (status === 'Em andamento' || status === 'Em análise') return 'info';
  return 'neutral';
}

function slaTone(status: SlaStatus): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'overdue' || status === 'breached') return 'danger';
  if (status === 'due_soon') return 'warning';
  if (status === 'paused') return 'neutral';
  if (status === 'met') return 'success';
  return 'info';
}

function slaLabel(status: SlaStatus): string {
  const labels: Record<SlaStatus, string> = {
    on_track: 'No prazo',
    due_soon: 'Próximo do prazo',
    overdue: 'Atrasada',
    paused: 'SLA pausado',
    met: 'SLA cumprido',
    breached: 'SLA rompido'
  };
  return labels[status];
}

function slaBarTone(status: SlaStatus): string {
  if (status === 'overdue' || status === 'breached') return 'bg-danger';
  if (status === 'due_soon') return 'bg-warning';
  if (status === 'met') return 'bg-success';
  if (status === 'paused') return 'bg-muted';
  return 'bg-info';
}

function progressPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatMinutes(value: number): string {
  const minutes = Math.round(value);
  const absolute = Math.abs(minutes);
  const days = Math.floor(absolute / 1440);
  const hours = Math.floor((absolute % 1440) / 60);
  const remainder = absolute % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (remainder > 0 || parts.length === 0) parts.push(`${remainder}min`);
  const label = parts.join(' ');
  return minutes < 0 ? `${label} (excedido)` : label;
}

export function OccurrenceDetailPage() {
  const { id } = useParams();
  const { toast } = useApp();
  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);
  const [history, setHistory] = useState<OccurrenceHistoryItem[]>([]);
  const [messages, setMessages] = useState<OccurrenceMessage[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pauses, setPauses] = useState<SlaPause[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState('Nova');
  const [closeReasonDraft, setCloseReasonDraft] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [detail, historyData, pausesData, messagesData] = await Promise.all([
        api<OccurrenceDetailResponse>(`/occurrences/${id}`),
        api<{ history: RawHistory[] }>(`/occurrences/${id}/history`),
        api<{ pauses: RawPause[] }>(`/occurrences/${id}/pauses`),
        api<{ messages: RawMessage[] }>(`/occurrences/${id}/messages`)
      ]);
      setOccurrence(detail.occurrence);
      setHistory((historyData.history ?? []).map(normalizeHistory));
      setPauses((pausesData.pauses ?? []).map(normalizePause));
      setMessages((messagesData.messages ?? []).map(normalizeMessage));
      setAttachments((detail.attachments ?? []).map(normalizeAttachment));
      setStatusDraft(detail.occurrence.status);
      setCloseReasonDraft(detail.occurrence.closeReason ?? '');
    } catch (error) {
      setOccurrence(null);
      setHistory([]);
      setMessages([]);
      setAttachments([]);
      setPauses([]);
      toast(error instanceof Error ? error.message : 'Erro ao carregar ocorrência.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const addNote = async () => {
    if (!note.trim() || !occurrence) return;
    try {
      await api(`/occurrences/${occurrence.id}/notes`, { method: 'POST', body: JSON.stringify({ note: note.trim() }) });
      setNote('');
      toast('Observação registrada.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao salvar observação.', 'error');
    }
  };

  const uploadAttachment = async (file: File | undefined) => {
    if (!file || !occurrence) return;
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

  const downloadAttachment = async (file: Attachment) => {
    setDownloadingId(file.id);
    try {
      await downloadFile(file.url, file.name);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao baixar arquivo.', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const updateStatus = async () => {
    if (!occurrence) return;
    const closing = isClosedStatus(statusDraft);
    if (closing && closeReasonDraft.trim().length < 3) {
      toast('Informe a justificativa de encerramento (mínimo de 3 caracteres).', 'error');
      return;
    }
    setSavingStatus(true);
    try {
      const payload: { status: string; closeReason?: string } = { status: statusDraft };
      if (closing && closeReasonDraft.trim()) payload.closeReason = closeReasonDraft.trim();
      await api(`/occurrences/${occurrence.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('Status atualizado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao atualizar status.', 'error');
    } finally {
      setSavingStatus(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-6 h-8 w-64" />
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!occurrence) {
    return (
      <div>
        <PageHeader
          title="Ocorrência"
          breadcrumbs={[{ label: 'Ocorrências', to: '/ocorrencias' }, { label: 'Não encontrada' }]}
        />
        <Card>
          <EmptyState
            icon={<ClipboardListIcon />}
            title="Ocorrência não encontrada"
            description="Verifique o código informado ou volte para a lista de ocorrências."
            action={<Link to="/ocorrencias"><Button variant="primary">Voltar às ocorrências</Button></Link>}
          />
        </Card>
      </div>
    );
  }

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
    ['Prioridade', occurrence.priority],
    ['Mensagens', String(occurrence.messageCount)],
    ['Anexos', String(occurrence.attachmentCount)],
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
              action={<Badge tone={statusTone(occurrence.status)}>{occurrence.status}</Badge>}
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
            </div>
          </Card>

          <Card>
            <CardHeader
              title="SLA"
              description={`Meta: ${formatMinutes(occurrence.sla.targetMinutes)} • Pausas acumuladas: ${formatMinutes(occurrence.sla.pausedMinutes)}`}
              action={<Badge tone={slaTone(occurrence.sla.status)}>{slaLabel(occurrence.sla.status)}</Badge>}
            />
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 text-muted"><Clock3 className="h-4 w-4" /> Prazo atual</span>
                <span className="font-medium text-ink">{formatDate(occurrence.sla.dueAt)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line/60">
                <div className={`h-full rounded-full ${slaBarTone(occurrence.sla.status)}`} style={{ width: `${progressPercent(occurrence.sla.progress)}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>Progresso: {progressPercent(occurrence.sla.progress)}%</span>
                <span>Restante: {formatMinutes(occurrence.sla.remainingMinutes)} ({Math.round(occurrence.sla.remainingMinutes)} min)</span>
              </div>
              {occurrence.originalDueAt && occurrence.originalDueAt !== occurrence.sla.dueAt && (
                <p className="text-[11px] text-muted">Prazo original: {formatDate(occurrence.originalDueAt)}</p>
              )}
            </div>
          </Card>

          {(isClosedStatus(occurrence.status) || Boolean(occurrence.closeReason)) && (
            <Card>
              <CardHeader
                title="Justificativa de encerramento"
                action={occurrence.closedAt ? <Badge tone="success">{formatDate(occurrence.closedAt)}</Badge> : undefined}
              />
              <div className="p-5">
                <p className="text-sm leading-relaxed text-ink">{occurrence.closeReason ?? 'Sem justificativa registrada.'}</p>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Alterar status" description="Statuses de aguardando pausam o SLA; ao sair, o prazo é retomado." />
            <div className="space-y-3 p-5">
              <Field label="Novo status">
                <Select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}>
                  {OCCURRENCE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </Select>
              </Field>
              {isClosedStatus(statusDraft) && (
                <Field label="Justificativa de encerramento *" hint="Obrigatório para Resolvida ou Encerrada (mínimo de 3 caracteres).">
                  <Textarea value={closeReasonDraft} onChange={(event) => setCloseReasonDraft(event.target.value)} />
                </Field>
              )}
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={() => void updateStatus()}
                  disabled={savingStatus || (isClosedStatus(statusDraft) && closeReasonDraft.trim().length < 3)}
                >
                  {savingStatus ? 'Salvando...' : 'Salvar status'}
                </Button>
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
                      <p className="mt-1 text-[11px] text-muted">{item.authorName ? `${item.authorName} • ` : ''}{relativeTime(item.createdAt)}</p>
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
            <CardHeader title="Pausas do SLA" description={`${pauses.length} pausa(s) registrada(s)`} />
            <div className="divide-y divide-line/60">
              {pauses.length === 0 ? (
                <EmptyState icon={<Clock3 className="h-5 w-5" />} title="Nenhuma pausa" description="Pausas aparecem aqui quando o status aguarda cliente, transportadora ou motorista." />
              ) : (
                pauses.map((pause) => (
                  <div key={pause.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-ink">{pause.reason}</p>
                      <Badge tone={pause.endedAt ? 'neutral' : 'warning'}>{pause.endedAt ? 'Retomado' : 'Em pausa'}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {formatDate(pause.startedAt)} → {pause.endedAt ? formatDate(pause.endedAt) : '—'} • {formatMinutes(pause.pausedMinutes)}
                    </p>
                    {pause.authorName && <p className="mt-0.5 text-[11px] text-muted">{pause.authorName}</p>}
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Anexos" description={`${occurrence.attachmentCount} arquivo(s)`} action={<label className="cursor-pointer text-xs font-medium text-info">{uploading ? 'Enviando...' : 'Adicionar'}<input type="file" className="hidden" onChange={(event) => void uploadAttachment(event.target.files?.[0])} /></label>} />
            <div className="divide-y divide-line/60">
              {attachments.length === 0 ? (
                <EmptyState icon={<Paperclip className="h-5 w-5" />} title="Nenhum anexo" description="Envie documentos ou imagens desta ocorrência." />
              ) : (
                attachments.map((file) => (
                  <div key={file.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-ink">{file.name}</p>
                      <p className="text-[11px] text-muted">
                        {(file.size / 1024).toFixed(0)} KB
                        {file.createdAt ? ` • ${formatDate(file.createdAt)}` : ''}
                        {file.authorName ? ` • ${file.authorName}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Baixar"
                      disabled={downloadingId === file.id}
                      onClick={() => void downloadAttachment(file)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Mensagens do WhatsApp" description={occurrence.messageCount ? `${occurrence.messageCount} mensagem(ns) associada(s)` : 'Nenhuma mensagem associada'} />
            <div className="max-h-96 divide-y divide-line/60 overflow-y-auto">
              {messages.length === 0 ? (
                <EmptyState icon={<MessageCircle className="h-5 w-5" />} title="Sem mensagens ligadas" description="Vincule mensagens na central WhatsApp." />
              ) : (
                messages.map((message) => (
                  <div key={message.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-info">{message.direction === 'inbound' ? message.authorName ?? 'Cliente' : 'Envio'}</span>
                      <span className="text-[10px] text-muted">{message.createdAt ? relativeTime(message.createdAt) : '—'}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{message.body || 'Mensagem sem texto'}</p>
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

function ClipboardListIcon() {
  return <ClipboardList className="h-5 w-5" />;
}
