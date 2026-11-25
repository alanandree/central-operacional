import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { Category, Occurrence } from '../lib/types';
import { OCCURRENCE_STATUSES, PRIORITIES } from '../lib/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../components/ui';

interface ListResponse {
  items: Occurrence[];
  total: number;
  page: number;
  limit: number;
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
  status: 'Nova ocorrência'
};

function localDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function statusTone(status: string): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'Resolvida' || status === 'Encerrada') return 'success';
  if (status === 'Aguardando retorno' || status === 'Aguardando cliente' || status === 'Aguardando transportadora') return 'warning';
  if (status === 'Em andamento' || status === 'Em análise') return 'info';
  return 'neutral';
}

function priorityTone(priority: string): 'neutral' | 'info' | 'warning' | 'danger' {
  if (priority === 'Urgente') return 'danger';
  if (priority === 'Alta') return 'warning';
  if (priority === 'Normal') return 'info';
  return 'neutral';
}

export function OccurrencesPage() {
  const { user, toast } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<Occurrence[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', categoryId: '', from: '', to: '', sort: 'created' });
  const [modalOpen, setModalOpen] = useState(searchParams.get('new') === '1');
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Occurrence | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    const params = new URLSearchParams({ page: String(page), limit: '20', sort: filters.sort });
    for (const [key, value] of Object.entries(filters)) {
      if (value && key !== 'sort') params.set(key, value);
    }
    try {
      const data = await api<ListResponse>(`/occurrences?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar ocorrências.', 'error');
    }
  };

  useEffect(() => {
    void load();
  }, [page, filters.search, filters.status, filters.priority, filters.categoryId, filters.from, filters.to, filters.sort]);

  useEffect(() => {
    api<{ categories: Category[] }>('/categories').then((data) => setCategories(data.categories)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing(null);
      setForm(emptyForm);
      setModalOpen(true);
    }
  }, [searchParams]);

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
      dueAt: localDateTime(occurrence.dueAt),
      status: occurrence.status
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        customerPhone: form.customerPhone || undefined,
        orderCode: form.orderCode || undefined,
        trackingCode: form.trackingCode || undefined,
        recipientName: form.recipientName || undefined,
        categoryId: form.categoryId || null,
        origin: form.origin || 'Manual',
        responsible: form.responsible || undefined,
        receivedAt: form.receivedAt ? new Date(form.receivedAt).toISOString() : undefined,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null
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

  return (
    <div>
      <PageHeader
        title="Ocorrências SAC"
        description="Registre, filtre e acompanhe cada problema de entrega."
        actions={<Button variant="primary" onClick={openCreate}><Plus className="h-4 w-4" /> Nova ocorrência</Button>}
      />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Input placeholder="Buscar cliente, pedido ou rastreamento" value={filters.search} onChange={(event) => { setPage(1); setFilters({ ...filters, search: event.target.value }); }} />
          <Select value={filters.status} onChange={(event) => { setPage(1); setFilters({ ...filters, status: event.target.value }); }}>
            <option value="">Todos os status</option>
            {OCCURRENCE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </Select>
          <Select value={filters.priority} onChange={(event) => { setPage(1); setFilters({ ...filters, priority: event.target.value }); }}>
            <option value="">Todas as prioridades</option>
            {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </Select>
          <Select value={filters.categoryId} onChange={(event) => { setPage(1); setFilters({ ...filters, categoryId: event.target.value }); }}>
            <option value="">Todas as categorias</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
          <Input type="date" value={filters.from} onChange={(event) => { setPage(1); setFilters({ ...filters, from: event.target.value }); }} />
          <Select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}>
            <option value="created">Mais recentes</option>
            <option value="received">Recebimento</option>
            <option value="due">Por prazo</option>
            <option value="priority">Por prioridade</option>
          </Select>
        </div>
      </Card>

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="Nenhuma ocorrência encontrada"
            description="Ajuste os filtros ou registre uma nova ocorrência para começar."
            action={<Button variant="primary" onClick={openCreate}>Nova ocorrência</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Prioridade</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Prazo</th>
                  <th className="px-5 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-line/20">
                    <td className="px-5 py-3">
                      <Link to={`/ocorrencias/${item.id}`} className="font-medium text-info hover:underline">{item.code}</Link>
                      {item.overdue && <Badge tone="danger" className="ml-2">atrasada</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-ink">{item.customerName}</p>
                      <p className="text-[11px] text-muted">{item.orderCode ? `Pedido ${item.orderCode}` : 'Sem pedido'}</p>
                    </td>
                    <td className="px-4 py-3 text-muted">{item.categoryName ?? 'Sem categoria'}</td>
                    <td className="px-4 py-3"><Badge tone={priorityTone(item.priority)}>{item.priority}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={statusTone(item.status)}>{item.status}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDate(item.dueAt)}</td>
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
        {total > 20 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
            <span>{total} ocorrências • página {page}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button>
              <Button size="sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Próxima</Button>
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
