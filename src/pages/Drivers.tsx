import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, FileWarning, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { api, cpfMask, formatDate } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { Driver } from '../lib/types';
import { DRIVER_STATUSES } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '../components/ui';

interface ListResponse { items: Driver[]; total: number; page: number; limit: number }

type FormState = {
  name: string;
  cpf: string;
  birthDate: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  cnhNumber: string;
  cnhCategory: string;
  cnhExpiry: string;
  notes: string;
  status: string;
};

const PAGE_LIMIT = 20;

const emptyForm: FormState = {
  name: '', cpf: '', birthDate: '', phone: '', email: '', address: '', city: '', state: '', zip: '',
  cnhNumber: '', cnhCategory: '', cnhExpiry: '', notes: '', status: 'Aguardando documentos'
};

function statusTone(status: string): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'Aprovado') return 'success';
  if (status === 'Reprovado' || status === 'Inativo') return 'danger';
  if (status === 'Em análise') return 'info';
  if (status === 'Aguardando documentos' || status === 'Documentação incompleta') return 'warning';
  return 'neutral';
}

function avatarSrc(url: string | null): string | null {
  return url?.startsWith('/api/') ? url.slice(4) : url;
}

function cnhLabel(alert: Driver['cnhAlert']): string {
  if (alert === 'expired') return 'CNH vencida';
  if (alert === 'soon') return 'CNH vencendo';
  if (alert === 'ok') return 'CNH em dia';
  return 'CNH sem validade';
}

function cnhTone(alert: Driver['cnhAlert']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (alert === 'expired') return 'danger';
  if (alert === 'soon') return 'warning';
  if (alert === 'ok') return 'success';
  return 'neutral';
}

export function DriversPage() {
  const { user, toast } = useApp();
  const [items, setItems] = useState<Driver[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Driver | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (pendingOnly) params.set('pendingDocuments', '1');
    if (expiringOnly) params.set('expiring', '1');
    try {
      const data = await api<ListResponse>(`/drivers?${params}`);
      setItems(data.items);
      setTotal(data.total);
      const totalPages = Math.max(1, Math.ceil(data.total / PAGE_LIMIT));
      if (page > totalPages) setPage(totalPages);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar motoristas.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, search, statusFilter, pendingOnly, expiringOnly]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setPhotoFile(null);
    setModalOpen(true);
  };

  const openEdit = (driver: Driver) => {
    setEditing(driver);
    setForm({
      name: driver.name,
      cpf: cpfMask(driver.cpf),
      birthDate: driver.birthDate ?? '',
      phone: driver.phone ?? '',
      email: driver.email ?? '',
      address: driver.address ?? '',
      city: driver.city ?? '',
      state: driver.state ?? '',
      zip: driver.zip ?? '',
      cnhNumber: driver.cnhNumber ?? '',
      cnhCategory: driver.cnhCategory ?? '',
      cnhExpiry: driver.cnhExpiry ?? '',
      notes: driver.notes ?? '',
      status: driver.status
    });
    setPhotoFile(null);
    setModalOpen(true);
  };

  const uploadPhoto = async (driverId: string, file: File) => {
    const body = new FormData();
    body.append('photo', file);
    await api(`/drivers/${driverId}/photo`, { method: 'POST', body });
  };

  const buildCreateForm = (): FormData => {
    const body = new FormData();
    for (const [key, value] of Object.entries(form)) body.append(key, value.trim());
    if (photoFile) body.append('photo', photoFile);
    return body;
  };

  const save = async () => {
    setSaving(true);
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null]));
    try {
      if (editing) {
        await api(`/drivers/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        if (photoFile) await uploadPhoto(editing.id, photoFile);
        toast('Motorista atualizado.');
      } else {
        let createdId: string | null = null;
        let createdPhotoUrl: string | null = null;
        try {
          const created = await api<{ driver?: Driver; id?: string }>('/drivers', { method: 'POST', body: buildCreateForm() });
          createdId = created.driver?.id ?? created.id ?? null;
          createdPhotoUrl = created.driver?.photoUrl ?? null;
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (message !== 'Dados inválidos.') throw error;
          const created = await api<{ driver?: Driver; id?: string }>('/drivers', { method: 'POST', body: JSON.stringify(payload) });
          createdId = created.driver?.id ?? created.id ?? null;
          createdPhotoUrl = created.driver?.photoUrl ?? null;
        }
        if (photoFile && createdId && !createdPhotoUrl) await uploadPhoto(createdId, photoFile);
        toast('Motorista cadastrado.');
      }
      setModalOpen(false);
      setPhotoFile(null);
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
      await api(`/drivers/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Motorista excluído.');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao excluir.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div>
      <PageHeader
        title="Motoristas"
        description="Cadastros, documentos e validade da CNH em um único lugar."
        actions={<Button variant="primary" onClick={openCreate}><Plus className="h-4 w-4" /> Novo motorista</Button>}
      />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_220px]">
          <Field label="Buscar">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input className="pl-9" placeholder="Nome, CPF, telefone ou CNH" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} />
            </div>
          </Field>
          <Field label="Status">
            <Select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }}>
              <option value="">Todos os status</option>
              {DRIVER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={pendingOnly ? 'primary' : 'secondary'}
            aria-pressed={pendingOnly}
            onClick={() => { setPage(1); setPendingOnly((current) => !current); }}
          >
            <FileWarning className="h-3.5 w-3.5" /> Documentos pendentes
          </Button>
          <Button
            size="sm"
            variant={expiringOnly ? 'primary' : 'secondary'}
            aria-pressed={expiringOnly}
            onClick={() => { setPage(1); setExpiringOnly((current) => !current); }}
          >
            <CalendarClock className="h-3.5 w-3.5" /> Documentos vencendo
          </Button>
        </div>
      </Card>

      <Card>
        {loading && items.length === 0 ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhum motorista encontrado" description="Cadastre um motorista ou ajuste os filtros para começar a organizar documentos e prazos." action={<Button variant="primary" onClick={openCreate}>Novo motorista</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">CPF</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">CNH</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Documentos</th>
                  <th className="px-5 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {items.map((driver) => (
                  <tr key={driver.id} className="hover:bg-line/20">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={avatarSrc(driver.photoUrl)}
                          name={driver.name}
                          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-canvas text-[11px] font-semibold text-info"
                        />
                        <div className="min-w-0">
                          <Link to={`/motoristas/${driver.id}`} className="font-medium text-info hover:underline">{driver.name}</Link>
                          <p className="text-[11px] text-muted">{driver.city || 'Cidade não informada'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{cpfMask(driver.cpf)}</td>
                    <td className="px-4 py-3 text-muted">{driver.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      <p className="text-muted">{driver.cnhNumber ?? '—'}</p>
                      <p className="text-[11px] text-muted">{driver.cnhExpiry ? formatDate(driver.cnhExpiry, false) : 'Sem validade'}</p>
                      <Badge className="mt-1" tone={cnhTone(driver.cnhAlert)}>{cnhLabel(driver.cnhAlert)}</Badge>
                    </td>
                    <td className="px-4 py-3"><Badge tone={statusTone(driver.status)}>{driver.status}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone="info">{driver.documentCount} doc(s)</Badge>
                        {driver.pendingDocuments > 0 && <Badge tone="warning"><FileWarning className="mr-1 h-3 w-3" />{driver.pendingDocuments} pendente(s)</Badge>}
                        {driver.expiringDocuments > 0 && <Badge tone="danger"><CalendarClock className="mr-1 h-3 w-3" />{driver.expiringDocuments} vencendo(s)</Badge>}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => openEdit(driver)}><Pencil className="h-4 w-4" /></Button>
                        {user?.role === 'admin' && (
                          <Button variant="ghost" size="icon" title="Excluir" onClick={() => setDeleteTarget(driver)}><Trash2 className="h-4 w-4 text-danger" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_LIMIT && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
            <span>{total} motoristas • página {page} de {totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</Button>
              <Button size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar motorista' : 'Novo motorista'}
        description="Os documentos são anexados na página de detalhes."
        wide
        footer={<><Button onClick={() => setModalOpen(false)}>Cancelar</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome completo *"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="CPF *"><Input value={form.cpf} onChange={(event) => setForm({ ...form, cpf: cpfMask(event.target.value) })} /></Field>
          <Field label="Data de nascimento"><Input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></Field>
          <Field label="Telefone"><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {DRIVER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </Select>
          </Field>
          <Field label="Endereço" className="sm:col-span-2"><Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field>
          <Field label="Cidade"><Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>
          <Field label="Estado"><Input maxLength={2} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} /></Field>
          <Field label="CEP"><Input value={form.zip} onChange={(event) => setForm({ ...form, zip: event.target.value })} /></Field>
          <Field label="Número da CNH"><Input value={form.cnhNumber} onChange={(event) => setForm({ ...form, cnhNumber: event.target.value })} /></Field>
          <Field label="Categoria da CNH"><Input value={form.cnhCategory} onChange={(event) => setForm({ ...form, cnhCategory: event.target.value })} /></Field>
          <Field label="Validade da CNH"><Input type="date" value={form.cnhExpiry} onChange={(event) => setForm({ ...form, cnhExpiry: event.target.value })} /></Field>
          <Field label="Foto" hint="Imagem opcional para identificação">
            <Input type="file" accept="image/*" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Observações" className="sm:col-span-2"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        loading={deleting}
        title="Excluir motorista?"
        description={`O cadastro de ${deleteTarget?.name ?? ''} e seus documentos serão excluídos.`}
      />
    </div>
  );
}
