import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Avatar } from '../components/Avatar';
import type { Category, Priority, WhatsappStatus } from '../lib/types';
import { OCCURRENCE_STATUSES, PRIORITIES } from '../lib/types';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Tabs, Textarea } from '../components/ui';

interface SettingsData {
  company: { name: string };
  slaDefaultHours: number;
  businessHours: { start: string; end: string; days: number[] };
  notificationOffsets: number[];
  whatsappGroupSupport: 'unknown' | 'yes' | 'no';
  holidays: string[];
  slaPriorityFactor: Record<Priority, number>;
  slaPauseStatuses: string[];
  documentAlertDays: number;
  retentionDays: number;
}

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'employee';
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SessionItem {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string | null;
  current: boolean;
}

interface AiStatus {
  configured: boolean;
  provider: string;
  model: string | null;
}

interface PrivacyRequest {
  id: string;
  user_id: string;
  type: 'exportacao' | 'exclusao';
  status: string;
  subject_name: string;
  created_at: string;
  completed_at: string | null;
}

interface CategoryPatch {
  name?: string;
  slaHours?: number;
  active?: boolean;
}

interface UserForm {
  id: string;
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'employee';
}

const weekDays = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' }
];

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseNumberList(value: string): number[] {
  return splitList(value).map(Number).filter((item) => Number.isFinite(item));
}

function requestTone(status: string): 'neutral' | 'success' | 'warning' {
  if (status === 'concluida') return 'success';
  if (status === 'pendente') return 'warning';
  return 'neutral';
}

export function SettingsPage() {
  const { user, toast, theme, refreshUser } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'geral';
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequest[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsappStatus | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [slaHours, setSlaHours] = useState(48);
  const [startHour, setStartHour] = useState('08:00');
  const [endHour, setEndHour] = useState('18:00');
  const [businessDays, setBusinessDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [holidays, setHolidays] = useState('');
  const [priorityFactors, setPriorityFactors] = useState<Record<Priority, number>>({ Baixa: 1.5, Normal: 1, Alta: 0.5, Urgente: 0.25 });
  const [pauseStatuses, setPauseStatuses] = useState<string[]>([]);
  const [offsets, setOffsets] = useState('24,12,2,0');
  const [groupSupport, setGroupSupport] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [documentAlertDays, setDocumentAlertDays] = useState(30);
  const [retentionDays, setRetentionDays] = useState(365);
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', slaHours: 48 });
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);
  const [userModal, setUserModal] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>({ id: '', name: '', email: '', password: '', role: 'employee' });
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
  const [privacyForm, setPrivacyForm] = useState<{ type: 'exportacao' | 'exclusao'; subjectName: string; details: string }>({
    type: 'exportacao',
    subjectName: '',
    details: ''
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });

  const load = async () => {
    try {
      const [settingsData, categoriesData, whatsappData, aiData] = await Promise.all([
        api<SettingsData>('/settings'),
        api<{ categories: Category[] }>('/categories'),
        api<WhatsappStatus>('/whatsapp/status'),
        api<AiStatus>('/ai/status')
      ]);
      setSettings(settingsData);
      setCompanyName(settingsData.company.name);
      setSlaHours(settingsData.slaDefaultHours);
      setStartHour(settingsData.businessHours.start);
      setEndHour(settingsData.businessHours.end);
      setBusinessDays(settingsData.businessHours.days);
      setHolidays(settingsData.holidays.join(', '));
      setPriorityFactors({
        Baixa: Number(settingsData.slaPriorityFactor.Baixa ?? 1.5),
        Normal: Number(settingsData.slaPriorityFactor.Normal ?? 1),
        Alta: Number(settingsData.slaPriorityFactor.Alta ?? 0.5),
        Urgente: Number(settingsData.slaPriorityFactor.Urgente ?? 0.25)
      });
      setPauseStatuses(settingsData.slaPauseStatuses);
      setOffsets(settingsData.notificationOffsets.join(','));
      setGroupSupport(settingsData.whatsappGroupSupport);
      setDocumentAlertDays(settingsData.documentAlertDays);
      setRetentionDays(settingsData.retentionDays);
      setCategories(categoriesData.categories);
      setWhatsapp(whatsappData);
      setAi(aiData);
      if (user?.role === 'admin') {
        const [usersData, requestsData] = await Promise.all([
          api<{ users: AppUser[] }>('/users'),
          api<{ requests: PrivacyRequest[] }>('/privacy-requests')
        ]);
        setUsers(usersData.users);
        setPrivacyRequests(requestsData.requests);
      }
      const sessionsData = await api<{ sessions: SessionItem[] }>('/auth/sessions');
      setSessions(sessionsData.sessions);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar configurações.', 'error');
    }
  };

  useEffect(() => {
    void load();
  }, [user?.role]);

  const saveGeneral = async () => {
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ companyName, slaDefaultHours: Number(slaHours) })
      });
      toast('Configurações salvas.');
      await refreshUser();
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao salvar.', 'error');
    }
  };

  const saveOperational = async () => {
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          businessHours: { start: startHour, end: endHour, days: [...businessDays].sort((left, right) => left - right) },
          holidays: splitList(holidays),
          slaPriorityFactor: priorityFactors,
          slaPauseStatuses: pauseStatuses,
          notificationOffsets: parseNumberList(offsets),
          whatsappGroupSupport: groupSupport,
          documentAlertDays: Number(documentAlertDays),
          retentionDays: Number(retentionDays)
        })
      });
      toast('Configurações operacionais salvas.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao salvar.', 'error');
    }
  };

  const saveCategory = async () => {
    try {
      await api('/categories', { method: 'POST', body: JSON.stringify({ name: categoryForm.name, slaHours: Number(categoryForm.slaHours) }) });
      toast('Categoria criada.');
      setCategoryModal(false);
      setCategoryForm({ name: '', slaHours: 48 });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao criar categoria.', 'error');
    }
  };

  const updateCategory = async (id: string, patch: CategoryPatch) => {
    try {
      await api(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao atualizar categoria.', 'error');
    }
  };

  const confirmDeleteCategory = async () => {
    if (!deleteCategory) return;
    try {
      await api(`/categories/${deleteCategory.id}`, { method: 'DELETE' });
      toast('Categoria excluída.');
      setDeleteCategory(null);
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao excluir.', 'error');
    }
  };

  const openUserModal = (item?: AppUser) => {
    setUserForm(item
      ? { id: item.id, name: item.name, email: item.email, password: '', role: item.role }
      : { id: '', name: '', email: '', password: '', role: 'employee' });
    setUserModal(true);
  };

  const saveUser = async () => {
    const editing = Boolean(userForm.id);
    try {
      const body = editing
        ? {
            name: userForm.name,
            email: userForm.email,
            role: userForm.role,
            ...(userForm.password ? { password: userForm.password } : {})
          }
        : { name: userForm.name, email: userForm.email, password: userForm.password, role: userForm.role };
      await api(editing ? `/users/${userForm.id}` : '/users', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      toast(editing ? 'Usuário atualizado.' : 'Usuário criado.');
      setUserModal(false);
      setUserForm({ id: '', name: '', email: '', password: '', role: 'employee' });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao salvar usuário.', 'error');
    }
  };

  const confirmDeleteUser = async () => {
    if (!deleteUser) return;
    try {
      await api(`/users/${deleteUser.id}`, { method: 'DELETE' });
      toast('Usuário excluído.');
      setDeleteUser(null);
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao excluir.', 'error');
    }
  };

  const changePassword = async () => {
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify(passwords) });
      toast('Senha alterada.');
      setPasswords({ currentPassword: '', newPassword: '' });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao alterar senha.', 'error');
    }
  };

  const changeTheme = async (next: 'dark' | 'light') => {
    try {
      await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ theme: next }) });
      await refreshUser();
      toast('Tema atualizado.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao alterar tema.', 'error');
    }
  };

  const revokeSession = async (id: string) => {
    try {
      await api(`/auth/sessions/${id}`, { method: 'DELETE' });
      toast('Sessão revogada.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao revogar sessão.', 'error');
    }
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    const body = new FormData();
    body.append('avatar', file);
    try {
      await api('/auth/avatar', { method: 'POST', body });
      toast('Foto de perfil atualizada.');
      await refreshUser();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao enviar imagem.', 'error');
    }
  };

  const exportData = async () => {
    try {
      const data = await api<unknown>('/privacy/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `exportacao-lgpd-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Exportação de dados gerada.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao exportar dados.', 'error');
    }
  };

  const submitPrivacyRequest = async () => {
    try {
      await api('/privacy-requests', { method: 'POST', body: JSON.stringify(privacyForm) });
      toast('Solicitação registrada.');
      setPrivacyForm((current) => ({ ...current, subjectName: '', details: '' }));
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao registrar solicitação.', 'error');
    }
  };

  const completePrivacyRequest = async (id: string) => {
    try {
      await api(`/privacy-requests/${id}/complete`, { method: 'PATCH' });
      toast('Solicitação concluída.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao concluir solicitação.', 'error');
    }
  };

  const toggleBusinessDay = (day: number) => {
    setBusinessDays((current) => current.includes(day)
      ? current.filter((item) => item !== day)
      : [...current, day].sort((left, right) => left - right));
  };

  const togglePauseStatus = (status: string) => {
    setPauseStatuses((current) => current.includes(status)
      ? current.filter((item) => item !== status)
      : [...current, status]);
  };

  const changeTab = (id: string) => {
    setTab(id);
    setSearchParams({ tab: id });
  };

  return (
    <div>
      <PageHeader title="Configurações" description="Empresa, SLA, categorias, usuários, privacidade, segurança e integrações." />

      <Tabs
        tabs={[
          { id: 'geral', label: 'Geral' },
          { id: 'operacional', label: 'Operacional' },
          { id: 'categorias', label: 'Categorias' },
          { id: 'usuarios', label: 'Usuários' },
          { id: 'privacidade', label: 'Privacidade' },
          { id: 'seguranca', label: 'Segurança' },
          { id: 'integracoes', label: 'Integrações' }
        ]}
        active={tab}
        onChange={changeTab}
      />

      <div className="mt-6">
        {tab === 'geral' && (settings ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Empresa e prazos" description="Dados usados nos relatórios e no cálculo de prazos" />
              <div className="space-y-4 p-5">
                <Field label="Nome da empresa"><Input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></Field>
                <Field label="SLA padrão (horas)" hint="Aplicado quando a categoria não define um prazo próprio">
                  <Input type="number" min={1} max={720} value={slaHours} onChange={(event) => setSlaHours(Number(event.target.value))} />
                </Field>
                {user?.role === 'admin' && <Button variant="primary" onClick={() => void saveGeneral()}>Salvar alterações</Button>}
              </div>
            </Card>

            <Card>
              <CardHeader title="Aparência" description="Preferência visual da conta" />
              <div className="space-y-4 p-5">
                <Field label="Tema">
                  <Select value={theme} onChange={(event) => void changeTheme(event.target.value as 'dark' | 'light')}>
                    <option value="dark">Escuro</option>
                    <option value="light">Claro</option>
                  </Select>
                </Field>
                <p className="text-xs text-muted">O tema é salvo na sua conta através da API.</p>
              </div>
            </Card>
          </div>
        ) : <Skeleton className="h-72" />)}

        {tab === 'operacional' && (settings ? (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Horário comercial e feriados" description="Usado para contar apenas minutos úteis no SLA" />
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <Field label="Início do expediente"><Input type="time" value={startHour} onChange={(event) => setStartHour(event.target.value)} /></Field>
                <Field label="Fim do expediente"><Input type="time" value={endHour} onChange={(event) => setEndHour(event.target.value)} /></Field>
                <div className="md:col-span-2">
                  <p className="mb-2 text-xs font-medium text-muted">Dias úteis</p>
                  <div className="flex flex-wrap gap-2">
                    {weekDays.map((day) => (
                      <button key={day.value} type="button" onClick={() => toggleBusinessDay(day.value)}>
                        <Badge tone={businessDays.includes(day.value) ? 'info' : 'neutral'}>{day.label}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Feriados" hint="Datas no formato AAAA-MM-DD, separadas por vírgula" className="md:col-span-2">
                  <Input value={holidays} placeholder="2026-01-01, 2026-12-25" onChange={(event) => setHolidays(event.target.value)} />
                </Field>
              </div>
            </Card>

            <Card>
              <CardHeader title="Regras de SLA" description="Fatores por prioridade e status que suspendem a contagem" />
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                {PRIORITIES.map((priority) => (
                  <Field key={priority} label={`Fator ${priority}`} hint="Multiplicador do prazo base">
                    <Input
                      type="number"
                      min={0.01}
                      step="0.25"
                      value={priorityFactors[priority]}
                      onChange={(event) => setPriorityFactors((current) => ({ ...current, [priority]: Number(event.target.value) }))}
                    />
                  </Field>
                ))}
              </div>
              <div className="border-t border-line px-5 py-4">
                <p className="mb-2 text-xs font-medium text-muted">Status que pausam o SLA</p>
                <div className="flex flex-wrap gap-2">
                  {OCCURRENCE_STATUSES.map((status) => (
                    <button key={status} type="button" onClick={() => togglePauseStatus(status)}>
                      <Badge tone={pauseStatuses.includes(status) ? 'warning' : 'neutral'}>{status}</Badge>
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Notificações, documentos e retenção" description="Alertas de prazo, validade de documentos e LGPD" />
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <Field label="Alertas de prazo (horas antes)" hint="Separe por vírgula">
                  <Input value={offsets} onChange={(event) => setOffsets(event.target.value)} />
                </Field>
                <Field label="Grupos do WhatsApp">
                  <Select value={groupSupport} onChange={(event) => setGroupSupport(event.target.value as 'unknown' | 'yes' | 'no')}>
                    <option value="unknown">Não verificado</option>
                    <option value="yes">Confirmado com suporte</option>
                    <option value="no">Sem suporte</option>
                  </Select>
                </Field>
                <Field label="Alerta de documentos (dias)" hint="Antecedência para CNH e documentos">
                  <Input type="number" min={1} max={365} value={documentAlertDays} onChange={(event) => setDocumentAlertDays(Number(event.target.value))} />
                </Field>
                <Field label="Retenção de dados (dias)" hint="Prazo de retenção para fins de LGPD">
                  <Input type="number" min={30} max={3650} value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value))} />
                </Field>
              </div>
              {user?.role === 'admin' && (
                <div className="flex justify-end border-t border-line p-4">
                  <Button variant="primary" onClick={() => void saveOperational()}>Salvar configurações operacionais</Button>
                </div>
              )}
            </Card>
          </div>
        ) : <Skeleton className="h-96" />)}

        {tab === 'categorias' && (
          <Card>
            <CardHeader
              title="Categorias de ocorrências"
              description="Prazo padrão por categoria"
              action={user?.role === 'admin' && <Button size="sm" onClick={() => setCategoryModal(true)}><Plus className="h-4 w-4" /> Nova</Button>}
            />
            <div className="divide-y divide-line/60">
              {categories.length === 0 ? (
                <EmptyState title="Nenhuma categoria" description="Crie categorias para organizar as ocorrências." />
              ) : (
                categories.map((category) => (
                  <div key={category.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-[180px] flex-1">
                      <Input
                        className="max-w-xs"
                        defaultValue={category.name}
                        disabled={user?.role !== 'admin'}
                        onBlur={(event) => {
                          if (event.target.value !== category.name) void updateCategory(category.id, { name: event.target.value });
                        }}
                      />
                      <p className="mt-1 text-[11px] text-muted">Criada em {formatDate(category.createdAt, false)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted">SLA</span>
                      <Input
                        type="number"
                        min={1}
                        max={720}
                        className="h-9 w-24"
                        defaultValue={category.slaHours}
                        disabled={user?.role !== 'admin'}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (value && value !== category.slaHours) void updateCategory(category.id, { slaHours: value });
                        }}
                      />
                      <span className="text-[11px] text-muted">h</span>
                    </div>
                    <button
                      type="button"
                      disabled={user?.role !== 'admin'}
                      onClick={() => void updateCategory(category.id, { active: !category.active })}
                    >
                      <Badge tone={category.active ? 'success' : 'neutral'}>{category.active ? 'Ativa' : 'Inativa'}</Badge>
                    </button>
                    {user?.role === 'admin' && <Button variant="ghost" size="icon" onClick={() => setDeleteCategory(category)}><Trash2 className="h-4 w-4 text-danger" /></Button>}
                  </div>
                ))
              )}
            </div>
          </Card>
        )}

        {tab === 'usuarios' && user?.role === 'admin' && (
          <Card>
            <CardHeader title="Usuários" description="Contas com acesso ao sistema" action={<Button size="sm" onClick={() => openUserModal()}><Plus className="h-4 w-4" /> Novo usuário</Button>} />
            <div className="divide-y divide-line/60">
              {users.length === 0 ? (
                <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhum usuário" description="Crie usuários para compartilhar o acesso." />
              ) : (
                users.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-ink">{item.name}</p>
                      <p className="text-[11px] text-muted">{item.email} • último acesso: {formatDate(item.lastLoginAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={item.role === 'admin' ? 'info' : 'neutral'}>{item.role}</Badge>
                      <Button variant="ghost" size="icon" onClick={() => openUserModal(item)}><Pencil className="h-4 w-4" /></Button>
                      {item.id !== user.id && <Button variant="ghost" size="icon" onClick={() => setDeleteUser(item)}><Trash2 className="h-4 w-4 text-danger" /></Button>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        )}

        {tab === 'privacidade' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Exportação de dados" description="Baixa os dados pessoais associados à sua conta" />
              <div className="space-y-4 p-5">
                <p className="text-xs text-muted">A exportação é gerada por GET /privacy/export com o seu token de acesso.</p>
                <Button variant="primary" onClick={() => void exportData()}>Exportar meus dados</Button>
              </div>
            </Card>

            <Card>
              <CardHeader title="Nova solicitação de LGPD" description="Registrada na empresa e notificada aos administradores" />
              <div className="space-y-4 p-5">
                <Field label="Tipo">
                  <Select value={privacyForm.type} onChange={(event) => setPrivacyForm((current) => ({ ...current, type: event.target.value as 'exportacao' | 'exclusao' }))}>
                    <option value="exportacao">Exportação</option>
                    <option value="exclusao">Exclusão</option>
                  </Select>
                </Field>
                <Field label="Nome do titular">
                  <Input value={privacyForm.subjectName} onChange={(event) => setPrivacyForm((current) => ({ ...current, subjectName: event.target.value }))} />
                </Field>
                <Field label="Detalhes" hint="Opcional, até 500 caracteres">
                  <Textarea maxLength={500} value={privacyForm.details} onChange={(event) => setPrivacyForm((current) => ({ ...current, details: event.target.value }))} />
                </Field>
                <Button variant="primary" disabled={privacyForm.subjectName.trim().length < 2} onClick={() => void submitPrivacyRequest()}>Enviar solicitação</Button>
              </div>
            </Card>

            {user?.role === 'admin' && (
              <Card className="lg:col-span-2">
                <CardHeader title="Solicitações de privacidade" description="Solicitações registradas pelos usuários da empresa" />
                <div className="divide-y divide-line/60">
                  {privacyRequests.length === 0 ? (
                    <EmptyState title="Nenhuma solicitação" description="As solicitações de LGPD aparecerão aqui." />
                  ) : (
                    privacyRequests.map((request) => (
                      <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <div>
                          <p className="text-sm font-medium text-ink">{request.subject_name}</p>
                          <p className="text-[11px] text-muted">{request.type} • {formatDate(request.created_at)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={requestTone(request.status)}>{request.status}</Badge>
                          {request.status !== 'concluida' && <Button size="sm" onClick={() => void completePrivacyRequest(request.id)}>Concluir</Button>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'seguranca' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Foto de perfil" />
              <div className="flex items-center gap-4 p-5">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-info/15 text-sm font-semibold text-info">
                  <Avatar src={user?.avatarUrl ?? null} name={user?.name ?? ''} className="flex h-full w-full items-center justify-center" />
                </div>
                <label className="cursor-pointer rounded-lg border border-line px-3 py-2 text-xs text-muted hover:text-ink">
                  Escolher imagem
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
                </label>
              </div>
            </Card>

            <Card>
              <CardHeader title="Alterar senha" />
              <div className="space-y-4 p-5">
                <Field label="Senha atual"><Input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></Field>
                <Field label="Nova senha" hint="Mínimo de 8 caracteres"><Input type="password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></Field>
                <Button variant="primary" onClick={() => void changePassword()} disabled={!passwords.currentPassword || passwords.newPassword.length < 8}><KeyRound className="h-4 w-4" /> Alterar senha</Button>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Sessões ativas" description="Revogue acessos que não reconhece" />
              <div className="divide-y divide-line/60">
                {sessions.filter((session) => !session.revoked_at).length === 0 ? (
                  <EmptyState title="Nenhuma sessão ativa" description="Não há sessões válidas para esta conta." />
                ) : (
                  sessions.filter((session) => !session.revoked_at).map((session) => (
                    <div key={session.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-xs text-ink">{session.current ? 'Sessão atual' : 'Outra sessão'}</p>
                        <p className="text-[11px] text-muted">Criada em {formatDate(session.created_at)} • expira em {formatDate(session.expires_at)}</p>
                      </div>
                      {!session.current && <Button size="sm" onClick={() => void revokeSession(session.id)}>Revogar</Button>}
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        )}

        {tab === 'integracoes' && whatsapp && ai && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="WhatsApp Business" action={<Badge tone={whatsapp.configured ? 'success' : 'warning'}>{whatsapp.configured ? 'Conectado' : 'Não configurado'}</Badge>} />
              <div className="space-y-3 p-5">
                <p className="text-xs text-muted">API oficial da Meta, sem QR Code ou automações não oficiais.</p>
                <p className="text-xs text-muted">Variáveis ausentes: {whatsapp.missing.join(', ') || 'nenhuma'}.</p>
                <p className="text-xs text-muted">Grupos: {whatsapp.groupSupport === 'yes' ? 'suporte confirmado' : whatsapp.groupSupport === 'no' ? 'sem suporte' : 'não verificado'}.</p>
                <Button onClick={() => window.location.assign('/whatsapp')}><RefreshCw className="h-4 w-4" /> Abrir central</Button>
              </div>
            </Card>
            <Card>
              <CardHeader title="Inteligência artificial" action={<Badge tone={ai.configured ? 'success' : 'warning'}>{ai.configured ? 'Ativa' : 'Desativada'}</Badge>} />
              <div className="space-y-3 p-5">
                <p className="text-xs text-muted">Provedor: {ai.provider}</p>
                <p className="text-xs text-muted">Modelo: {ai.model ?? '—'}</p>
                <p className="text-xs text-muted">Configure OPENAI_API_KEY no .env para habilitar. Nada é simulado.</p>
                <Button onClick={() => window.location.assign('/assistente')}>Abrir assistente</Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Modal
        open={categoryModal}
        onClose={() => setCategoryModal(false)}
        title="Nova categoria"
        footer={<><Button onClick={() => setCategoryModal(false)}>Cancelar</Button><Button variant="primary" onClick={() => void saveCategory()}>Criar</Button></>}
      >
        <div className="space-y-4">
          <Field label="Nome"><Input value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} /></Field>
          <Field label="SLA padrão (horas)"><Input type="number" min={1} max={720} value={categoryForm.slaHours} onChange={(event) => setCategoryForm({ ...categoryForm, slaHours: Number(event.target.value) })} /></Field>
        </div>
      </Modal>

      <Modal
        open={userModal}
        onClose={() => setUserModal(false)}
        title={userForm.id ? 'Editar usuário' : 'Novo usuário'}
        footer={<>
          <Button onClick={() => setUserModal(false)}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!userForm.name.trim() || !userForm.email.trim() || (userForm.id ? userForm.password.length > 0 && userForm.password.length < 8 : userForm.password.length < 8)}
            onClick={() => void saveUser()}
          >
            {userForm.id ? 'Salvar' : 'Criar'}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <Field label="Nome"><Input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></Field>
          <Field label={userForm.id ? 'Nova senha (opcional)' : 'Senha'} hint="Mínimo de 8 caracteres">
            <Input type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
          </Field>
          <Field label="Perfil">
            <Select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as 'admin' | 'employee' })}>
              <option value="employee">Funcionário</option>
              <option value="admin">Administrador</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(deleteCategory)} onClose={() => setDeleteCategory(null)} onConfirm={() => void confirmDeleteCategory()} title="Excluir categoria?" description={`A categoria ${deleteCategory?.name ?? ''} será removida. Ocorrências existentes ficarão sem categoria.`} />
      <ConfirmDialog open={Boolean(deleteUser)} onClose={() => setDeleteUser(null)} onConfirm={() => void confirmDeleteUser()} title="Excluir usuário?" description={`O usuário ${deleteUser?.name ?? ''} perderá o acesso imediatamente.`} />
    </div>
  );
}
