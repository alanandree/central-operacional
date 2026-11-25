import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Link2, MessageCircle, RefreshCw, Send, Upload, XCircle } from 'lucide-react';
import { api, formatDate, relativeTime } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { AiSuggestion, Driver, Occurrence, RegistrationFlow, WhatsappConversation, WhatsappMessage, WhatsappStatus } from '../lib/types';
import { PRIORITIES } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Tabs, Textarea } from '../components/ui';

const TABS = [
  { id: 'conversas', label: 'Conversas' },
  { id: 'mensagens', label: 'Mensagens' },
  { id: 'triagem', label: 'Triagem' },
  { id: 'cadastros', label: 'Cadastros' }
];

const MSG_STATUSES = ['', 'pendente', 'triagem_pendente', 'sem_ocorrencia', 'enviada', 'cadastro', 'midia_falhou'];

function msgStatusTone(status: string, processed: boolean): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (processed || status === 'enviada') return 'success';
  if (status === 'midia_falhou') return 'danger';
  if (status === 'triagem_pendente' || status === 'pendente') return 'warning';
  return 'neutral';
}

function msgStatusLabel(status: string, processed: boolean): string {
  if (processed) return 'Processada';
  if (status === 'triagem_pendente') return 'Triagem pendente';
  if (status === 'sem_ocorrencia') return 'Sem ocorrência';
  if (status === 'enviada') return 'Enviada';
  if (status === 'cadastro') return 'Cadastro';
  if (status === 'midia_falhou') return 'Mídia falhou';
  return status || 'Pendente';
}

function priorityTone(priority: string): 'neutral' | 'info' | 'warning' | 'danger' {
  if (priority === 'Urgente') return 'danger';
  if (priority === 'Alta') return 'warning';
  if (priority === 'Normal') return 'info';
  return 'neutral';
}

function suggestionTone(status: string): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'aprovada' || status === 'vinculada') return 'success';
  if (status === 'rejeitada') return 'danger';
  if (status === 'pendente') return 'warning';
  return 'neutral';
}

function within24h(value: string | null | undefined): boolean {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 24 * 60 * 60 * 1000;
}

export function WhatsAppPage() {
  const { toast } = useApp();
  const [tab, setTab] = useState('conversas');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [conversations, setConversations] = useState<WhatsappConversation[]>([]);
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [flows, setFlows] = useState<RegistrationFlow[]>([]);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [displayNumber, setDisplayNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [registrationTemplate, setRegistrationTemplate] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [filters, setFilters] = useState({ search: '', fromNumber: '', direction: '', processed: '', processingStatus: '', hasMedia: '', occurrenceId: '' });
  const [importData, setImportData] = useState({ fromNumber: '', body: '', occurredAt: '', occurrenceId: '', driverId: '' });
  const [importing, setImporting] = useState(false);
  const [sendData, setSendData] = useState({ to: '', message: '', occurrenceId: '', templateName: '' });
  const [sending, setSending] = useState(false);
  const [editMsg, setEditMsg] = useState<WhatsappMessage | null>(null);
  const [editData, setEditData] = useState({ occurrenceId: '', driverId: '', processed: false, processingStatus: '' });
  const [savingMsg, setSavingMsg] = useState(false);
  const [review, setReview] = useState<AiSuggestion | null>(null);
  const [reviewData, setReviewData] = useState({ customerName: '', customerPhone: '', categoryId: '', priority: 'Normal', description: '', orderCode: '', trackingCode: '', notes: '' });
  const [reviewBusy, setReviewBusy] = useState('');
  const [linkTarget, setLinkTarget] = useState<AiSuggestion | null>(null);
  const [linkOccurrenceId, setLinkOccurrenceId] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);

  const loadBase = async () => {
    const [statusData, occData, drvData, catData] = await Promise.all([
      api<WhatsappStatus>('/whatsapp/status'),
      api<{ items: Occurrence[] }>('/occurrences?limit=100'),
      api<{ items: Driver[] }>('/drivers?limit=100'),
      api<{ categories?: Array<{ id: string; name: string }>; items?: Array<{ id: string; name: string }> }>('/categories').catch(() => ({ categories: [] as Array<{ id: string; name: string }> } as { categories?: Array<{ id: string; name: string }>; items?: Array<{ id: string; name: string }> }))
    ]);
    setStatus(statusData);
    setDisplayNumber(statusData.displayNumber ?? '');
    setNotes(statusData.notes ?? '');
    setOccurrences(occData.items);
    setDrivers(drvData.items);
    setCategories(catData.categories ?? catData.items ?? []);
  };

  const loadTab = async (currentTab = tab, currentFilters = filters) => {
    if (currentTab === 'conversas') {
      const data = await api<{ conversations: WhatsappConversation[] }>('/whatsapp/conversations');
      setConversations(data.conversations);
    }
    if (currentTab === 'mensagens') {
      const params = new URLSearchParams({ limit: '100' });
      Object.entries(currentFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const data = await api<{ messages: WhatsappMessage[]; total: number }>(`/whatsapp/messages?${params.toString()}`);
      setMessages(data.messages);
      setMessagesTotal(data.total);
    }
    if (currentTab === 'triagem') {
      const data = await api<{ suggestions: AiSuggestion[] }>('/ai/suggestions?limit=100');
      setSuggestions(data.suggestions);
    }
    if (currentTab === 'cadastros') {
      const data = await api<{ flows: RegistrationFlow[] }>('/whatsapp/flows');
      setFlows(data.flows);
    }
  };

  const loadAll = async (currentTab = tab) => {
    setLoading(true);
    try {
      await loadBase();
      await loadTab(currentTab);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar WhatsApp.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAll('conversas'); }, []);

  useEffect(() => {
    if (!loading) void loadTab(tab).catch((e) => toast(e instanceof Error ? e.message : 'Erro ao carregar aba.', 'error'));
  }, [tab]);

  const refresh = async () => {
    try {
      await loadBase();
      await loadTab();
      toast('Dados atualizados.', 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao atualizar.', 'error');
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api('/whatsapp/config', {
        method: 'POST',
        body: JSON.stringify({
          displayNumber: displayNumber || null,
          notes: notes || null,
          ...(registrationTemplate ? { registrationTemplate } : {})
        })
      });
      toast('Configuração salva.');
      await loadBase();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao salvar configuração.', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      const result = await api<{ verified: boolean; displayNumber: string }>('/whatsapp/verify', { method: 'POST' });
      toast(result.verified ? `Credenciais verificadas: ${result.displayNumber}` : 'Verificação concluída.');
      await loadBase();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao verificar credenciais.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const applyFilters = async () => {
    try {
      await loadTab('mensagens', filters);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao filtrar mensagens.', 'error');
    }
  };

  const importMessage = async () => {
    if (!importData.fromNumber.trim() || !importData.body.trim()) {
      toast('Informe remetente e mensagem.', 'error');
      return;
    }
    setImporting(true);
    try {
      await api('/whatsapp/messages/import', {
        method: 'POST',
        body: JSON.stringify({
          fromNumber: importData.fromNumber.trim(),
          body: importData.body.trim(),
          ...(importData.occurredAt ? { occurredAt: new Date(importData.occurredAt).toISOString() } : {}),
          occurrenceId: importData.occurrenceId || null,
          driverId: importData.driverId || null
        })
      });
      toast('Mensagem importada.');
      setImportData({ fromNumber: '', body: '', occurredAt: '', occurrenceId: '', driverId: '' });
      await Promise.all([loadTab('mensagens'), loadTab('triagem'), loadTab('conversas')]);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao importar mensagem.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const sendMessage = async () => {
    if (!sendData.to.trim()) {
      toast('Informe o destinatário.', 'error');
      return;
    }
    const lastInbound = conversations.find((c) => c.phone === sendData.to.trim())?.lastAt;
    const useTemplate = !within24h(lastInbound);
    if (!useTemplate && !sendData.message.trim()) {
      toast('Informe a mensagem.', 'error');
      return;
    }
    setSending(true);
    try {
      await api('/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({
          to: sendData.to.trim(),
          ...(useTemplate ? { templateName: sendData.templateName || undefined } : { message: sendData.message.trim() }),
          occurrenceId: sendData.occurrenceId || null
        })
      });
      toast(useTemplate ? 'Template enviado.' : 'Mensagem enviada.');
      setSendData((s) => ({ ...s, message: '' }));
      await loadTab('mensagens');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao enviar.', 'error');
    } finally {
      setSending(false);
    }
  };

  const openEdit = (msg: WhatsappMessage) => {
    setEditMsg(msg);
    setEditData({ occurrenceId: msg.occurrenceId ?? '', driverId: msg.driverId ?? '', processed: msg.processed, processingStatus: msg.processingStatus });
  };

  const saveMsg = async () => {
    if (!editMsg) return;
    setSavingMsg(true);
    try {
      await api(`/whatsapp/messages/${editMsg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          occurrenceId: editData.occurrenceId || null,
          driverId: editData.driverId || null,
          processed: editData.processed,
          processingStatus: editData.processingStatus || undefined
        })
      });
      toast('Mensagem atualizada.');
      setEditMsg(null);
      await loadTab('mensagens');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao atualizar mensagem.', 'error');
    } finally {
      setSavingMsg(false);
    }
  };

  const openReview = (s: AiSuggestion) => {
    setReview(s);
    setReviewData({
      customerName: s.customerName ?? '',
      customerPhone: s.customerPhone ?? '',
      categoryId: categories.find((c) => c.name === s.category)?.id ?? '',
      priority: s.priority || 'Normal',
      description: s.description ?? '',
      orderCode: s.orderCode ?? '',
      trackingCode: s.trackingCode ?? '',
      notes: ''
    });
  };

  const approve = async () => {
    if (!review) return;
    setReviewBusy('approve');
    try {
      const payload: Record<string, string> = {};
      if (reviewData.customerName) payload.customerName = reviewData.customerName;
      if (reviewData.customerPhone) payload.customerPhone = reviewData.customerPhone;
      if (reviewData.categoryId) payload.categoryId = reviewData.categoryId;
      if (reviewData.priority) payload.priority = reviewData.priority;
      if (reviewData.description) payload.description = reviewData.description;
      if (reviewData.orderCode) payload.orderCode = reviewData.orderCode;
      if (reviewData.trackingCode) payload.trackingCode = reviewData.trackingCode;
      if (reviewData.notes) payload.notes = reviewData.notes;
      const res = await api<{ occurrenceId: string }>(`/ai/suggestions/${review.id}/approve`, { method: 'POST', body: JSON.stringify(payload) });
      toast(`Ocorrência criada: ${res.occurrenceId.slice(0, 8)}.`);
      setReview(null);
      await Promise.all([loadTab('triagem'), loadTab('mensagens')]);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao aprovar sugestão.', 'error');
    } finally {
      setReviewBusy('');
    }
  };

  const linkSuggestion = async () => {
    if (!linkTarget || !linkOccurrenceId) return;
    setReviewBusy('link');
    try {
      await api(`/ai/suggestions/${linkTarget.id}/link`, { method: 'POST', body: JSON.stringify({ occurrenceId: linkOccurrenceId }) });
      toast('Sugestão vinculada.');
      setLinkTarget(null);
      setLinkOccurrenceId('');
      await loadTab('triagem');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao vincular sugestão.', 'error');
    } finally {
      setReviewBusy('');
    }
  };

  const reject = async (s: AiSuggestion) => {
    const notes = window.prompt('Motivo da rejeição (opcional):') ?? undefined;
    if (notes === undefined) return;
    try {
      await api(`/ai/suggestions/${s.id}/reject`, { method: 'POST', body: JSON.stringify(notes ? { notes } : {}) });
      toast('Sugestão rejeitada.');
      await loadTab('triagem');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao rejeitar sugestão.', 'error');
    }
  };

  const cancelFlow = async (id: string) => {
    try {
      await api(`/whatsapp/flows/${id}/cancel`, { method: 'POST' });
      toast('Fluxo cancelado.');
      await loadTab('cadastros');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao cancelar fluxo.', 'error');
    }
  };

  const selectedConversation = useMemo(() => conversations.find((c) => c.phone === filters.fromNumber), [conversations, filters.fromNumber]);

  return (
    <div>
      <PageHeader
        title="WhatsApp"
        description="Central de mensagens, triagem e cadastros via WhatsApp."
        actions={<Button onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /> Atualizar</Button>}
      />

      <Card className="mb-6">
        <CardHeader
          title="Status da integração"
          description="WhatsApp Business Cloud API oficial."
          action={<Badge tone={status?.configured ? 'success' : 'warning'}>{status?.configured ? 'Configurado' : 'Não configurado'}</Badge>}
        />
        {loading && !status ? (
          <div className="grid gap-3 p-5 sm:grid-cols-4">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : status && (
          <>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-[11px] uppercase text-muted">Provedor</p><p className="mt-1 text-sm text-ink">{status.provider}</p></div>
              <div><p className="text-[11px] uppercase text-muted">Número</p><p className="mt-1 text-sm text-ink">{status.displayNumber || 'Não informado'}</p></div>
              <div><p className="text-[11px] uppercase text-muted">Última sync</p><p className="mt-1 text-sm text-ink">{formatDate(status.lastSyncAt)}</p></div>
              <div><p className="text-[11px] uppercase text-muted">Verificação</p><p className="mt-1 text-sm text-ink">{status.verified ? 'Verificado' : 'Não verificado'}</p></div>
            </div>
            <div className="flex flex-wrap gap-2 px-5 pb-4">
              {status.capabilities.map((c) => <Badge key={c} tone="info">{c}</Badge>)}
              <Badge tone={status.groupSupport === 'yes' ? 'success' : status.groupSupport === 'no' ? 'neutral' : 'warning'}>
                Grupos: {status.groupSupport === 'yes' ? 'sim' : status.groupSupport === 'no' ? 'não' : 'desconhecido'}
              </Badge>
              {status.officialOnly && <Badge tone="neutral">Apenas API oficial</Badge>}
            </div>
            {!status.configured && (
              <div className="mx-5 mb-5 flex gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                <div className="text-xs text-muted">
                  <p className="font-medium text-warning">Credenciais ausentes ou incompletas.</p>
                  <p className="mt-1">Faltando: {status.missing.join(', ') || 'nenhuma'}.</p>
                </div>
              </div>
            )}
            <div className="border-t border-line p-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Número exibido"><Input value={displayNumber} onChange={(e) => setDisplayNumber(e.target.value)} placeholder="+55 11 99999-9999" /></Field>
                <Field label="Observações"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                <Field label="Template de cadastro"><Input value={registrationTemplate} onChange={(e) => setRegistrationTemplate(e.target.value)} placeholder="nome_do_template" /></Field>
                <div className="flex items-end gap-2">
                  <Button variant="primary" onClick={() => void saveConfig()} disabled={savingConfig}>{savingConfig ? 'Salvando...' : 'Salvar'}</Button>
                  <Button onClick={() => void verify()} disabled={verifying || !status.credentialsPresent}>{verifying ? 'Verificando...' : 'Verificar'}</Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                <span>Webhook:</span>
                <code className="rounded bg-canvas px-2 py-1">{status.webhookUrl}</code>
                <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}${status.webhookUrl}`); toast('URL copiada.', 'info'); }}><Copy className="h-3.5 w-3.5" /> Copiar</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <div className="mb-4"><Tabs tabs={TABS} active={tab} onChange={setTab} /></div>

      {tab === 'conversas' && (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader title="Conversas" description={`${conversations.length} conversa(s)`} />
            <div className="max-h-[560px] divide-y divide-line/60 overflow-auto">
              {loading ? <div className="space-y-3 p-4">{[0,1,2,3].map((i)=><Skeleton key={i} className="h-14 w-full" />)}</div>
                : conversations.length === 0 ? <EmptyState icon={<MessageCircle className="h-5 w-5" />} title="Sem conversas" description="Mensagens recebidas aparecerão aqui." />
                : conversations.map((c) => (
                  <button key={c.phone} className={`w-full px-4 py-3 text-left hover:bg-line/20 ${filters.fromNumber === c.phone ? 'bg-line/20' : ''}`} onClick={() => { setFilters((f) => ({ ...f, fromNumber: c.phone })); setTab('mensagens'); void loadTab('mensagens', { ...filters, fromNumber: c.phone }); }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{c.driverName || c.phone}</span>
                      <span className="text-[11px] text-muted">{relativeTime(c.lastAt)}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">{c.lastBody || '—'}</p>
                    <div className="mt-2 flex gap-1">
                      {c.pendingCount > 0 && <Badge tone="warning">{c.pendingCount} pendente(s)</Badge>}
                      {c.pendingSuggestions > 0 && <Badge tone="info">{c.pendingSuggestions} triagem</Badge>}
                    </div>
                  </button>
                ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Importar / Enviar" description="Ações rápidas" />
            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-ink">Importar mensagem</p>
                <Field label="Remetente"><Input value={importData.fromNumber} onChange={(e) => setImportData({ ...importData, fromNumber: e.target.value })} /></Field>
                <Field label="Mensagem"><Textarea value={importData.body} onChange={(e) => setImportData({ ...importData, body: e.target.value })} /></Field>
                <Field label="Data/hora (opcional)"><Input type="datetime-local" value={importData.occurredAt} onChange={(e) => setImportData({ ...importData, occurredAt: e.target.value })} /></Field>
                <Field label="Ocorrência"><Select value={importData.occurrenceId} onChange={(e) => setImportData({ ...importData, occurrenceId: e.target.value })}><option value="">Nenhuma</option>{occurrences.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.customerName}</option>)}</Select></Field>
                <Field label="Motorista"><Select value={importData.driverId} onChange={(e) => setImportData({ ...importData, driverId: e.target.value })}><option value="">Nenhum</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                <Button variant="primary" onClick={() => void importMessage()} disabled={importing}><Upload className="h-4 w-4" /> {importing ? 'Importando...' : 'Importar'}</Button>
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold text-ink">Enviar mensagem</p>
                <Field label="Destinatário"><Input value={sendData.to} onChange={(e) => setSendData({ ...sendData, to: e.target.value })} placeholder="5511999999999" /></Field>
                <Field label="Mensagem" hint={!within24h(conversations.find((c)=>c.phone===sendData.to)?.lastAt) && sendData.to ? 'Fora da janela 24h: será enviado template.' : undefined}>
                  <Textarea value={sendData.message} onChange={(e) => setSendData({ ...sendData, message: e.target.value })} />
                </Field>
                <Field label="Template (opcional)"><Input value={sendData.templateName} onChange={(e) => setSendData({ ...sendData, templateName: e.target.value })} placeholder="central_operacional_update" /></Field>
                <Field label="Ocorrência"><Select value={sendData.occurrenceId} onChange={(e) => setSendData({ ...sendData, occurrenceId: e.target.value })}><option value="">Nenhuma</option>{occurrences.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.customerName}</option>)}</Select></Field>
                <Button variant="primary" onClick={() => void sendMessage()} disabled={sending || !status?.configured}><Send className="h-4 w-4" /> {sending ? 'Enviando...' : 'Enviar'}</Button>
                {!status?.configured && <p className="text-[11px] text-warning">Configure credenciais para enviar.</p>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'mensagens' && (
        <Card>
          <CardHeader title="Mensagens" description={`${messagesTotal} mensagem(ns)${selectedConversation ? ` — ${selectedConversation.driverName || selectedConversation.phone}` : ''}`} />
          <div className="border-b border-line p-4">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Field label="Busca"><Input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></Field>
              <Field label="Número"><Input value={filters.fromNumber} onChange={(e) => setFilters({ ...filters, fromNumber: e.target.value })} /></Field>
              <Field label="Direção"><Select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}><option value="">Todas</option><option value="inbound">Recebida</option><option value="outbound">Enviada</option></Select></Field>
              <Field label="Processada"><Select value={filters.processed} onChange={(e) => setFilters({ ...filters, processed: e.target.value })}><option value="">Todas</option><option value="0">Pendente</option><option value="1">Processada</option></Select></Field>
              <Field label="Status"><Select value={filters.processingStatus} onChange={(e) => setFilters({ ...filters, processingStatus: e.target.value })}>{MSG_STATUSES.map((s) => <option key={s} value={s}>{s || 'Todos'}</option>)}</Select></Field>
              <Field label="Mídia"><Select value={filters.hasMedia} onChange={(e) => setFilters({ ...filters, hasMedia: e.target.value })}><option value="">Todas</option><option value="1">Com mídia</option></Select></Field>
            </div>
            <div className="mt-3 flex gap-2"><Button size="sm" variant="primary" onClick={() => void applyFilters()}>Filtrar</Button><Button size="sm" onClick={() => { const f = { search: '', fromNumber: '', direction: '', processed: '', processingStatus: '', hasMedia: '', occurrenceId: '' }; setFilters(f); void loadTab('mensagens', f); }}>Limpar</Button></div>
          </div>
          <div className="divide-y divide-line/60">
            {loading ? <div className="space-y-3 p-4">{[0,1,2,3].map((i)=><Skeleton key={i} className="h-16 w-full" />)}</div>
              : messages.length === 0 ? <EmptyState icon={<MessageCircle className="h-5 w-5" />} title="Nenhuma mensagem" description="Ajuste os filtros ou importe uma mensagem." />
              : messages.map((m) => (
                <div key={m.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={m.direction === 'inbound' ? 'info' : 'success'}>{m.direction === 'inbound' ? 'Recebida' : 'Enviada'}</Badge>
                      <span className="text-xs text-ink">{m.direction === 'inbound' ? m.fromNumber : m.toNumber}{m.contactName ? ` (${m.contactName})` : ''}</span>
                      <Badge tone={msgStatusTone(m.processingStatus, m.processed)}>{msgStatusLabel(m.processingStatus, m.processed)}</Badge>
                      {m.suggestionCount > 0 && <Badge tone="warning">{m.suggestionCount} sugestão(ões)</Badge>}
                      {m.occurrenceNumber && <Badge tone="info">OC {m.occurrenceNumber}</Badge>}
                    </div>
                    <span className="text-[11px] text-muted">{formatDate(m.occurredAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{m.body || '—'}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.mediaFileId && <a className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-info hover:bg-line/20" href={`/api/files/${m.mediaFileId}/download`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> {m.mediaName || 'Mídia'}</a>}
                    <Button size="sm" variant="ghost" onClick={() => openEdit(m)}><Link2 className="h-3.5 w-3.5" /> Vincular/Editar</Button>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {tab === 'triagem' && (
        <Card>
          <CardHeader title="Triagem de sugestões" description="Aprovar cria ocorrência; vincular associa a existente; rejeitar descarta." />
          <div className="divide-y divide-line/60">
            {loading ? <div className="space-y-3 p-4">{[0,1,2,3].map((i)=><Skeleton key={i} className="h-20 w-full" />)}</div>
              : suggestions.length === 0 ? <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Sem sugestões" description="Sugestões geradas pela análise de mensagens aparecem aqui." />
              : suggestions.map((s) => (
                <div key={s.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={suggestionTone(s.status)}>{s.status}</Badge>
                        <Badge tone={priorityTone(s.priority)}>{s.priority}</Badge>
                        <Badge tone={s.isComplaint ? 'warning' : 'neutral'}>{s.isComplaint ? 'Reclamação' : 'Não reclamação'}</Badge>
                        <span className="text-[11px] text-muted">{s.source} • {Math.round(s.confidence * 100)}%</span>
                      </div>
                      <p className="mt-2 text-sm text-ink">{s.description || s.messageBody || '—'}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                        {s.customerName && <span>Cliente: {s.customerName}</span>}
                        {s.customerPhone && <span>Tel: {s.customerPhone}</span>}
                        {s.category && <span>Categoria: {s.category}</span>}
                        {s.orderCode && <span>Pedido: {s.orderCode}</span>}
                        {s.trackingCode && <span>Rastreio: {s.trackingCode}</span>}
                        {s.missingFields?.length > 0 && <span className="text-warning">Faltando: {s.missingFields.join(', ')}</span>}
                      </div>
                      {s.messageBody && <p className="mt-2 rounded bg-canvas p-2 text-[11px] text-muted">Msg: {s.messageBody}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {s.status === 'pendente' && <>
                        <Button size="sm" variant="primary" onClick={() => openReview(s)}><CheckCircle2 className="h-3.5 w-3.5" /> Aprovar</Button>
                        <Button size="sm" onClick={() => { setLinkTarget(s); setLinkOccurrenceId(''); }}><Link2 className="h-3.5 w-3.5" /> Vincular</Button>
                        <Button size="sm" variant="danger" onClick={() => void reject(s)}><XCircle className="h-3.5 w-3.5" /> Rejeitar</Button>
                      </>}
                      {s.createdOccurrenceId && <Badge tone="success">OC criada</Badge>}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {tab === 'cadastros' && (
        <Card>
          <CardHeader title="Fluxos de pré-cadastro" description="Cadastros de motoristas iniciados pelo WhatsApp." />
          <div className="divide-y divide-line/60">
            {loading ? <div className="space-y-3 p-4">{[0,1,2,3].map((i)=><Skeleton key={i} className="h-14 w-full" />)}</div>
              : flows.length === 0 ? <EmptyState icon={<MessageCircle className="h-5 w-5" />} title="Sem fluxos" description="Nenhum fluxo de cadastro pendente." />
              : flows.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">{f.phone}</span>
                      <Badge tone={f.status === 'pendente' ? 'warning' : 'neutral'}>{f.status}</Badge>
                      <Badge tone="info">{f.step}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">Atualizado {relativeTime(f.updatedAt)} • Criado {formatDate(f.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    {f.driverId && <Badge tone="success">Motorista criado</Badge>}
                    {f.status !== 'cancelado' && f.status !== 'concluido' && <Button size="sm" variant="danger" onClick={() => void cancelFlow(f.id)}>Cancelar</Button>}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      <Modal open={Boolean(editMsg)} onClose={() => setEditMsg(null)} title="Editar mensagem" description="Vincule a ocorrência/motorista ou ajuste status."
        footer={<><Button onClick={() => setEditMsg(null)}>Cancelar</Button><Button variant="primary" onClick={() => void saveMsg()} disabled={savingMsg}>{savingMsg ? 'Salvando...' : 'Salvar'}</Button></>}>
        <div className="space-y-4">
          <Field label="Ocorrência"><Select value={editData.occurrenceId} onChange={(e) => setEditData({ ...editData, occurrenceId: e.target.value })}><option value="">Nenhuma</option>{occurrences.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.customerName}</option>)}</Select></Field>
          <Field label="Motorista"><Select value={editData.driverId} onChange={(e) => setEditData({ ...editData, driverId: e.target.value })}><option value="">Nenhum</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Status de processamento"><Select value={editData.processingStatus} onChange={(e) => setEditData({ ...editData, processingStatus: e.target.value })}>{MSG_STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={editData.processed} onChange={(e) => setEditData({ ...editData, processed: e.target.checked })} /> Processada</label>
        </div>
      </Modal>

      <Modal open={Boolean(review)} onClose={() => setReview(null)} title="Revisar sugestão" description="Confirme os dados antes de criar a ocorrência." wide
        footer={<><Button onClick={() => setReview(null)}>Cancelar</Button><Button variant="primary" onClick={() => void approve()} disabled={reviewBusy === 'approve'}>{reviewBusy === 'approve' ? 'Aprovando...' : 'Aprovar e criar ocorrência'}</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cliente"><Input value={reviewData.customerName} onChange={(e) => setReviewData({ ...reviewData, customerName: e.target.value })} /></Field>
          <Field label="Telefone"><Input value={reviewData.customerPhone} onChange={(e) => setReviewData({ ...reviewData, customerPhone: e.target.value })} /></Field>
          <Field label="Categoria"><Select value={reviewData.categoryId} onChange={(e) => setReviewData({ ...reviewData, categoryId: e.target.value })}><option value="">Sem categoria</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Prioridade"><Select value={reviewData.priority} onChange={(e) => setReviewData({ ...reviewData, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
          <Field label="Pedido"><Input value={reviewData.orderCode} onChange={(e) => setReviewData({ ...reviewData, orderCode: e.target.value })} /></Field>
          <Field label="Rastreamento"><Input value={reviewData.trackingCode} onChange={(e) => setReviewData({ ...reviewData, trackingCode: e.target.value })} /></Field>
          <Field label="Descrição" className="sm:col-span-2"><Textarea value={reviewData.description} onChange={(e) => setReviewData({ ...reviewData, description: e.target.value })} /></Field>
          <Field label="Notas da revisão" className="sm:col-span-2"><Textarea value={reviewData.notes} onChange={(e) => setReviewData({ ...reviewData, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={Boolean(linkTarget)} onClose={() => setLinkTarget(null)} title="Vincular sugestão" description="Associe a sugestão a uma ocorrência existente."
        footer={<><Button onClick={() => setLinkTarget(null)}>Cancelar</Button><Button variant="primary" onClick={() => void linkSuggestion()} disabled={!linkOccurrenceId || reviewBusy === 'link'}>{reviewBusy === 'link' ? 'Vinculando...' : 'Vincular'}</Button></>}>
        <Field label="Ocorrência"><Select value={linkOccurrenceId} onChange={(e) => setLinkOccurrenceId(e.target.value)}><option value="">Selecione</option>{occurrences.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.customerName}</option>)}</Select></Field>
      </Modal>
    </div>
  );
}
