import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { Category, Occurrence, SlaStatus } from '../lib/types';
import { OCCURRENCE_STATUSES, PRIORITIES } from '../lib/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '../components/ui';

interface ListResponse {
  items: Occurrence[];
  total: number;
  page: number;
  limit: number;
}

interface Filters {
  search: string;
  categoryId: string;
  status: string;
  priority: string;
  responsible: string;
  from: string;
  to: string;
  closedFrom: string;
  closedTo: string;
  sla: string;
  sort: string;
}

type FormState = {
  customerName: string;
  customerPhone: string;
  orderCode: string;
  trackingCode: string;
  recipientName: string;
  categoryId: string;
  description: string;
  receivedAt: string;
  origin: string;
  responsible: string;
  priority: string;
  dueAt: string;
  status: string;
  closeReason: string;
};

const PAGE_SIZE = 20;
const CLOSED_STATUSES = ['Resolvida', 'Encerrada'];

const emptyFilters: Filters = {
  search: '',
  categoryId: '',
  status: '',
  priority: '',
  responsible: '',
  from: '',
  to: '',
  closedFrom: '',
  closedTo: '',
  sla: '',
  sort: 'created'
};

const emptyForm: FormState = {
  customerName: '',
  customerPhone: '',
  orderCode: '',
  trackingCode: '',
  recipientName: '',
  categoryId: '',
  description: '',
  receivedAt: '',
  origin: 'WhatsApp',
  responsible: '',
  priority: 'Normal',
  dueAt: '',
  status: 'Nova',
  closeReason: ''
};

function localDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.includes(status);
}

function statusTone(status: string): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (isClosedStatus(status)) return 'success';
  if (status.startsWith('Aguardando')) return 'warning';
  if (status === 'Em andamento' || status === 'Em análise') return 'info';
  return 'neutral';
}

function priorityTone(priority: string): 'neutral' | 'info' | 'warning' | 'danger' {
  if (priority === 'Urgente') return 'danger';
  if (priority === 'Alta') return 'warning';
  if (priority === 'Normal') return 'info';
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

export function OccurrencesPage() {
  const { user, toast } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<Occurrence[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [modalOpen, setModalOpen] = useState(searchParams.get('new') === '1');
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Occurrence | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort: filters.sort });
    for (const [key, value] of Object.entries(filters)) {
      if (value && key !== 'sort') params.set(key, value);
    }
    try {
      const data = await api<ListResponse>(`/occurrences?${params.toString()}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      setItems([]);
      setTotal(0);
      toast(error instanceof Error ? error.message : 'Erro ao carregar ocorrências.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const data = await api<{ categories?: Category[]; items?: Category[] }>('/categories');
      setCategories(data.categories ?? data.items ?? []);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar categorias.', 'error');
    }
  };

  useEffect(() => {
    void load();
  }, [page, filters]);

  useEffect(() => {
    void loadCategories();
  }, []);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing(null);
      setForm(emptyForm);
      setModalOpen(true);
    }
  }, [searchParams]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
    setSearchParams({});
  };

  const openEdit = (occurrence: Occurrence) => {
    setEditing(occurrence);
    setForm({
      customerName: occurrence.customerName,
      customerPhone: occurrence.customerPhone ?? '',
      orderCode: occurrence.orderCode ?? '',
      trackingCode: occurrence.trackingCode ?? '',
      recipientName: occurrence.recipientName ?? '',
      categoryId: occurrence.categoryId ?? '',
      description: occurrence.description,
      receivedAt: localDateTime(occurrence.receivedAt),
      origin: occurrence.origin,
      responsible: occurrence.responsible ?? '',
      priority: occurrence.priority,
      dueAt: localDateTime(occurrence.originalDueAt),
      status: occurrence.status,
      closeReason: occurrence.closeReason ?? ''
    });
    setModalOpen(true);
  };

  const save = async () => {
    const closing = isClosedStatus(form.status);
    if (!form.customerName.trim() || !form.description.trim()) {
      toast('Informe o nome do cliente e a descrição do problema.', 'error');
      return;
    }
    if (closing && form.closeReason.trim().length < 3) {
      toast('Informe a justificativa de encerramento (mínimo de 3 caracteres).', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone || undefined,
        orderCode: form.orderCode || undefined,
        trackingCode: form.trackingCode || undefined,
        recipientName: form.recipientName || undefined,
        categoryId: form.categoryId || undefined,
        description: form.description.trim(),
        receivedAt: form.receivedAt ? new Date(form.receivedAt).toISOString() : undefined,
        origin: form.origin || 'Manual',
        responsible: form.responsible || undefined,
        priority: form.priority,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
        status: form.status,
        closeReason: closing ? form.closeReason.trim() : undefined
      };
      if (editing) await api(`/occurrences/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/occurrences', { method: 'POST', body: JSON.stringify(payload) });
      toast(editing ? 'Ocorrência atualizada.' : 'Ocorrência registrada.');
      setModalOpen(false);
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/occurrences/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Ocorrência excluída.');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao excluir.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const closing = isClosedStatus(form.status);

  return (
    <div>
      <PageHeader
        title="Ocorrências SAC"
        description="Registre, filtre e acompanhe cada problema de entrega."
        actions={<Button variant="primary" onClick={openCreate}><Plus className="h-4 w-4" /> Nova ocorrência</Button>}
      />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <Field label="Busca">
            <Input placeholder="Cliente, pedido, rastreamento ou código" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} />
          </Field>
          <Field label="Categoria">
            <Select value={filters.categoryId} onChange={(event) => updateFilter('categoryId', event.target.value)}>
              <option value="">Todas as categorias</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">Todos os status</option>
              {OCCURRENCE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select value={filters.priority} onChange={(event) => updateFilter('priority', event.target.value)}>
              <option value="">Todas as prioridades</option>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </Select>
          </Field>
          <Field label="Responsável">
            <Input placeholder="Nome do responsável" value={filters.responsible} onChange={(event) => updateFilter('responsible', event.target.value)} />
          </Field>
          <Field label="Recebido de">
            <Input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
          </Field>
          <Field label="Recebido até">
            <Input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
          </Field>
          <Field label="Encerrado de">
            <Input type="date" value={filters.closedFrom} onChange={(event) => updateFilter('closedFrom', event.target.value)} />
          </Field>
          <Field label="Encerrado até">
            <Input type="date" value={filters.closedTo} onChange={(event) => updateFilter('closedTo', event.target.value)} />
          </Field>
          <Field label="SLA">
            <Select value={filters.sla} onChange={(event) => updateFilter('sla', event.target.value)}>
              <option value="">Todos</option>
              <option value="overdue">Atrasadas</option>
              <option value="paused">Com SLA pausado</option>
            </Select>
          </Field>
          <Field label="Ordenação">
            <Select value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value)}>
              <option value="created">Criação (recentes)</option>
              <option value="recent">Recebimento (recentes)</option>
              <option value="due">Por prazo</option>
              <option value="priority">Por prioridade</option>
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => { setPage(1); setFilters(emptyFilters); }}>Limpar filtros</Button>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-12 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="Nenhuma ocorrência encontrada"
            description="Ajuste os filtros ou registre uma nova ocorrência para começar."
            action={<Button variant="primary" onClick={openCreate}>Nova ocorrência</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Prioridade</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">SLA</th>
                  <th className="px-4 py-3 font-medium">Prazo</th>
                  <th className="px-5 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-line/20">
                    <td className="px-5 py-3">
                      <Link to={`/ocorrencias/${item.id}`} className="font-medium text-info hover:underline">{item.code}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-ink">{item.customerName}</p>
                      <p className="text-[11px] text-muted">
                        {item.orderCode ? `Pedido ${item.orderCode}` : 'Sem pedido'}
                        {item.trackingCode ? ` • Rastro ${item.trackingCode}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-muted">{item.categoryName ?? 'Sem categoria'}</td>
                    <td className="px-4 py-3"><Badge tone={priorityTone(item.priority)}>{item.priority}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={statusTone(item.status)}>{item.status}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex w-32 flex-col gap-1">
                        <Badge tone={slaTone(item.sla.status)}>{slaLabel(item.sla.status)}</Badge>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-line/60">
                          <div className={`h-full rounded-full ${slaBarTone(item.sla.status)}`} style={{ width: `${progressPercent(item.sla.progress)}%` }} />
                        </div>
                        <span className="text-[11px] text-muted">
                          {formatMinutes(item.sla.remainingMinutes)}
                          {item.sla.status === 'paused' && item.sla.pausedMinutes > 0 ? ` • ${formatMinutes(item.sla.pausedMinutes)} pausados` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-ink">{formatDate(item.sla.dueAt)}</p>
                      {item.originalDueAt && item.originalDueAt !== item.sla.dueAt && (
                        <p className="text-[11px] text-muted">Original: {formatDate(item.originalDueAt)}</p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
                        {user?.role === 'admin' && (
                          <Button variant="ghost" size="icon" title="Excluir" onClick={() => setDeleteTarget(item)}><Trash2 className="h-4 w-4 text-danger" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && total > 0 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
            <span>
              {total} ocorrências • página {page} de {totalPages} • {items.length} nesta página
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</Button>
              <Button size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Editar ${editing.code}` : 'Nova ocorrência'}
        description="Preencha apenas informações conhecidas."
        wide
        footer={<><Button onClick={() => setModalOpen(false)}>Cancelar</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do cliente *"><Input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></Field>
          <Field label="Telefone do cliente"><Input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></Field>
          <Field label="Código do pedido"><Input value={form.orderCode} onChange={(event) => setForm({ ...form, orderCode: event.target.value })} /></Field>
          <Field label="Código de rastreamento"><Input value={form.trackingCode} onChange={(event) => setForm({ ...form, trackingCode: event.target.value })} /></Field>
          <Field label="Destinatário"><Input value={form.recipientName} onChange={(event) => setForm({ ...form, recipientName: event.target.value })} /></Field>
          <Field label="Categoria">
            <Select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">Sem categoria</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
          <Field label="Recebimento"><Input type="datetime-local" value={form.receivedAt} onChange={(event) => setForm({ ...form, receivedAt: event.target.value })} /></Field>
          <Field label="Origem"><Input value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} /></Field>
          <Field label="Responsável"><Input value={form.responsible} onChange={(event) => setForm({ ...form, responsible: event.target.value })} /></Field>
          <Field label="Prioridade">
            <Select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </Select>
          </Field>
          <Field label="Prazo de resolução" hint="Vazio = prazo padrão da categoria"><Input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {OCCURRENCE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </Select>
          </Field>
          {closing && (
            <Field label="Justificativa de encerramento *" className="sm:col-span-2" hint="Obrigatório para Resolvida ou Encerrada (mínimo de 3 caracteres).">
              <Textarea value={form.closeReason} onChange={(event) => setForm({ ...form, closeReason: event.target.value })} />
            </Field>
          )}
          <Field label="Descrição do problema *" className="sm:col-span-2">
            <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        loading={deleting}
        title="Excluir ocorrência?"
        description={`A ocorrência ${deleteTarget?.code ?? ''} e seu histórico serão excluídos permanentemente.`}
      />
    </div>
  );
}
