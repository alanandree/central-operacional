import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Avatar } from '../components/Avatar';
import type { Category, User, WhatsappStatus } from '../lib/types';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Tabs } from '../components/ui';

interface SettingsData {
  company: { name: string };
  slaDefaultHours: number;
  businessHours: { start: string; end: string; days: number[] };
  notificationOffsets: number[];
  whatsappGroupSupport: 'unknown' | 'yes' | 'no';
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

interface SessionItem { id: string; created_at: string; expires_at: string; current: boolean }

interface AiStatus { configured: boolean; provider: string; model: string | null }

export function SettingsPage() {
  const { user, toast, theme, refreshUser } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'geral';
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsappStatus | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [slaHours, setSlaHours] = useState(48);
  const [startHour, setStartHour] = useState('08:00');
  const [endHour, setEndHour] = useState('18:00');
  const [groupSupport, setGroupSupport] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [offsets, setOffsets] = useState('24,12,2,0');
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', slaHours: 48 });
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);
  const [userModal, setUserModal] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'employee' });
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
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
      setGroupSupport(settingsData.whatsappGroupSupport);
      setOffsets(settingsData.notificationOffsets.join(','));
      setCategories(categoriesData.categories);
      setWhatsapp(whatsappData);
      setAi(aiData);
      if (user?.role === 'admin') {
        const usersData = await api<{ users: AppUser[] }>('/users');
        setUsers(usersData.users);
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
        body: JSON.stringify({
          companyName,
          slaDefaultHours: Number(slaHours),
          businessHours: { start: startHour, end: endHour, days: settings?.businessHours.days ?? [1, 2, 3, 4, 5] },
          notificationOffsets: offsets.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item)),
          whatsappGroupSupport: groupSupport
        })
      });
      toast('Configurações salvas.');
      await refreshUser();
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

  const updateCategory = async (category: Category, patch: Partial<Category>) => {
    try {
      await api(`/categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: patch.name, slaHours: patch.sla_hours, active: patch.active })
      });
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

  const saveUser = async () => {
    try {
      await api('/users', { method: 'POST', body: JSON.stringify(userForm) });
      toast('Usuário criado.');
      setUserModal(false);
      setUserForm({ name: '', email: '', password: '', role: 'employee' });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao criar usuário.', 'error');
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
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao alterar senha.', 'error');
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

  const changeTab = (id: string) => {
    setTab(id);
    setSearchParams({ tab: id });
  };

  return (
    <div>
      <PageHeader title="Configurações" description="Empresa, categorias, usuários, segurança e integrações." />

      <Tabs
        tabs={[
          { id: 'geral', label: 'Geral' },
          { id: 'categorias', label: 'Categorias' },
          { id: 'usuarios', label: 'Usuários' },
          { id: 'seguranca', label: 'Segurança' },
          { id: 'integracoes', label: 'Integrações' }
        ]}
        active={tab}
        onChange={changeTab}
      />

      <div className="mt-6">
        {tab === 'geral' && settings && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Empresa e prazos" />
              <div className="space-y-4 p-5">
                <Field label="Nome da empresa"><Input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></Field>
                <Field label="SLA padrão (horas)"><Input type="number" min={1} value={slaHours} onChange={(event) => setSlaHours(Number(event.target.value))} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Início do expediente"><Input type="time" value={startHour} onChange={(event) => setStartHour(event.target.value)} /></Field>
                  <Field label="Fim do expediente"><Input type="time" value={endHour} onChange={(event) => setEndHour(event.target.value)} /></Field>
                </div>
                <Field label="Alertas de prazo (horas antes)" hint="Separe por vírgula"><Input value={offsets} onChange={(event) => setOffsets(event.target.value)} /></Field>
                <Field label="Grupos do WhatsApp">
                  <Select value={groupSupport} onChange={(event) => setGroupSupport(event.target.value as 'unknown' | 'yes' | 'no')}>
                    <option value="unknown">Não verificado</option>
                    <option value="yes">Confirmado com suporte</option>
                    <option value="no">Sem suporte</option>
                  </Select>
                </Field>
                {user?.role === 'admin' && <Button variant="primary" onClick={() => void saveGeneral()}>Salvar alterações</Button>}
              </div>
            </Card>

            <Card>
              <CardHeader title="Aparência" description="Preferência visual da conta" />
              <div className="space-y-4 p-5">
                <Field label="Tema">
                  <Select value={theme} onChange={(event) => {
                    const next = event.target.value as 'dark' | 'light';
                    setTab('geral');
                    void api('/auth/me', { method: 'PATCH', body: JSON.stringify({ theme: next }) }).then(() => refreshUser());
                  }}>
                    <option value="dark">Escuro</option>
                    <option value="light">Claro</option>
                  </Select>
                </Field>
                <p className="text-xs text-muted">O tema é aplicado imediatamente e salvo na sua conta.</p>
              </div>
            </Card>
          </div>
        )}

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
                    <Input className="max-w-xs" defaultValue={category.name} disabled={user?.role !== 'admin'} onBlur={(event) => {
                      if (event.target.value !== category.name) void updateCategory(category, { name: event.target.value } as Partial<Category>);
                    }} />
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted">SLA</span>
                      <Input type="number" className="h-9 w-24" defaultValue={category.sla_hours} disabled={user?.role !== 'admin'} onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (value && value !== category.sla_hours) void updateCategory(category, { sla_hours: value });
                      }} />
                      <span className="text-[11px] text-muted">h</span>
                    </div>
                    <button
                      disabled={user?.role !== 'admin'}
                      onClick={() => void updateCategory(category, { active: !category.active } as Partial<Category>)}
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
            <CardHeader title="Usuários" description="A arquitetura permite adicionar novos usuários" action={<Button size="sm" onClick={() => setUserModal(true)}><Plus className="h-4 w-4" /> Novo usuário</Button>} />
            <div className="divide-y divide-line/60">
              {users.length === 0 ? (
                <EmptyState icon={<Users className="h-5 w-5" />} title="Nenhum usuário" description="Crie usuários para compartilhar o acesso." />
              ) : (
                users.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-ink">{item.name}</p>
                      <p className="text-[11px] text-muted">{item.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={item.role === 'admin' ? 'info' : 'neutral'}>{item.role}</Badge>
                      {item.id !== user.id && <Button variant="ghost" size="icon" onClick={() => setDeleteUser(item)}><Trash2 className="h-4 w-4 text-danger" /></Button>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
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
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-xs text-ink">{session.current ? 'Sessão atual' : 'Outra sessão'}</p>
                      <p className="text-[11px] text-muted">{new Date(session.created_at).toLocaleString('pt-BR')}</p>
                    </div>
                    {!session.current && <Button size="sm" onClick={() => void revokeSession(session.id)}>Revogar</Button>}
                  </div>
                ))}
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
                <Button onClick={() => window.location.assign('/whatsapp')}><RefreshCw className="h-4 w-4" /> Abrir central</Button>
              </div>
            </Card>
            <Card>
              <CardHeader title="Inteligência artificial" action={<Badge tone={ai.configured ? 'success' : 'warning'}>{ai.configured ? 'Ativa' : 'Desativada'}</Badge>} />
              <div className="space-y-3 p-5">
                <p className="text-xs text-muted">Provedor: {ai.provider}</p>
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
          <Field label="SLA padrão (horas)"><Input type="number" value={categoryForm.slaHours} onChange={(event) => setCategoryForm({ ...categoryForm, slaHours: Number(event.target.value) })} /></Field>
        </div>
      </Modal>

      <Modal
        open={userModal}
        onClose={() => setUserModal(false)}
        title="Novo usuário"
        footer={<><Button onClick={() => setUserModal(false)}>Cancelar</Button><Button variant="primary" onClick={() => void saveUser()}>Criar</Button></>}
      >
        <div className="space-y-4">
          <Field label="Nome"><Input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></Field>
          <Field label="Senha"><Input type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /></Field>
          <Field label="Perfil">
            <Select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
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
