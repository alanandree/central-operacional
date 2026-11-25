import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, CarFront, ClipboardList, Clock3, FileWarning, MessageCircle, PauseCircle, Sparkles, TimerReset } from 'lucide-react';
import { api, formatDate, relativeTime } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { DelaysResponse, Driver, Occurrence, SlaStatus, WhatsappStatus } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, StatCard, Tabs } from '../components/ui';

interface DashboardData {
  metrics: {
    open: number;
    inProgress: number;
    waitingResponse: number;
    concluded: number;
    overdue: number;
    drivers: number;
    pendingDrivers: number;
    expiringDocuments: number;
  };
  charts: {
    day: Array<{ label: string; total: number }>;
    week: Array<{ label: string; total: number }>;
    month: Array<{ label: string; total: number }>;
    categories: Array<{ label: string; total: number }>;
  };
  activities: Array<{ id: string; action: string; entity: string; created_at: string; user_name: string }>;
  upcoming: Array<{ id: string; code: string; customer_name: string; due_at: string; priority: string; status: string }>;
  summary: string;
  summarySource: string;
}

interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface AttentionData {
  delays: DelaysResponse;
  paused: ListResponse<Occurrence>;
  pendingDrivers: ListResponse<Driver>;
  expiringDrivers: ListResponse<Driver>;
  whatsapp: WhatsappStatus;
}

const pieColors = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#64748B'];

function occurrenceCode(number: number): string {
  return `OC-${String(number).padStart(5, '0')}`;
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
  return minutes < 0 ? `${parts.join(' ')} excedidos` : parts.join(' ');
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
    due_soon: 'Próxima do prazo',
    overdue: 'Atrasada',
    paused: 'SLA pausado',
    met: 'SLA cumprido',
    breached: 'SLA rompido'
  };
  return labels[status];
}

export function DashboardPage() {
  const { toast } = useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [attention, setAttention] = useState<AttentionData | null>(null);
  const [chartMode, setChartMode] = useState<'day' | 'week' | 'month'>('day');

  useEffect(() => {
    Promise.all([
      api<DashboardData>('/dashboard'),
      api<DelaysResponse>('/ai/delays', { method: 'POST', body: JSON.stringify({}) }),
      api<ListResponse<Occurrence>>('/occurrences?sla=paused&limit=5&sort=due'),
      api<ListResponse<Driver>>('/drivers?pendingDocuments=1&limit=5'),
      api<ListResponse<Driver>>('/drivers?expiring=1&limit=5'),
      api<WhatsappStatus>('/whatsapp/status')
    ])
      .then(([dashboard, delays, paused, pendingDrivers, expiringDrivers, whatsapp]) => {
        setData(dashboard);
        setAttention({ delays, paused, pendingDrivers, expiringDrivers, whatsapp });
      })
      .catch((error) => toast(error instanceof Error ? error.message : 'Erro ao carregar dashboard.', 'error'));
  }, []);

  if (!data || !attention) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => <Skeleton key={key} className="h-28" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const chartData = data.charts[chartMode];
  const hasOccurrences = data.metrics.open + data.metrics.concluded > 0;
  const dueSoonAlerts = attention.delays.alerts.filter((item) => item.slaStatus === 'due_soon');
  const overdueAlerts = attention.delays.alerts.filter((item) => item.slaStatus === 'overdue');
  const allAlerts = [...overdueAlerts, ...dueSoonAlerts];
  const driversToReview = new Map<string, Driver>();
  for (const driver of attention.pendingDrivers.items) driversToReview.set(driver.id, driver);
  for (const driver of attention.expiringDrivers.items) driversToReview.set(driver.id, driver);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Visão geral do trabalho operacional em tempo real."
        actions={
          <>
            <Button onClick={() => window.location.assign('/ocorrencias?new=1')} variant="primary">Nova ocorrência</Button>
            <Link to="/relatorios"><Button>Relatórios</Button></Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ocorrências abertas" value={data.metrics.open} icon={<ClipboardList className="h-4 w-4" />} tone="info" />
        <StatCard label="Em andamento" value={data.metrics.inProgress} icon={<Activity className="h-4 w-4" />} tone="success" />
        <StatCard label="Aguardando resposta" value={data.metrics.waitingResponse} icon={<Clock3 className="h-4 w-4" />} tone="warning" />
        <StatCard label="Atrasadas" value={data.metrics.overdue} icon={<AlertTriangle className="h-4 w-4" />} tone="danger" />
        <StatCard label="Concluídas" value={data.metrics.concluded} icon={<TimerReset className="h-4 w-4" />} tone="success" />
        <StatCard label="Motoristas" value={data.metrics.drivers} icon={<CarFront className="h-4 w-4" />} tone="info" />
        <StatCard label="Cadastros pendentes" value={data.metrics.pendingDrivers} icon={<ClipboardList className="h-4 w-4" />} tone="warning" />
        <StatCard label="CNHs próximas do vencimento" value={data.metrics.expiringDocuments} icon={<FileWarning className="h-4 w-4" />} tone="danger" />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="SLA atrasadas" value={data.metrics.overdue} icon={<AlertTriangle className="h-4 w-4" />} tone="danger" hint={`${overdueAlerts.length} alerta(s) ativo(s)`} />
        <StatCard label="Próximas do prazo" value={dueSoonAlerts.length} icon={<Clock3 className="h-4 w-4" />} tone="warning" hint="Calculado pelas regras de SLA" />
        <StatCard label="SLA pausadas" value={attention.paused.total} icon={<PauseCircle className="h-4 w-4" />} tone="neutral" hint="Aguardando cliente, transportadora ou motorista" />
        <StatCard label="Motoristas a revisar" value={driversToReview.size} icon={<FileWarning className="h-4 w-4" />} tone="warning" hint={`${attention.pendingDrivers.total} pendentes • ${attention.expiringDrivers.total} vencendo`} />
      </div>

      {!attention.whatsapp.configured && (
        <Card className="mt-4 border-warning/40">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium text-ink">WhatsApp não configurado</p>
                <p className="mt-1 text-xs text-muted">Variáveis ausentes: {attention.whatsapp.missing.join(', ') || 'nenhuma'}.</p>
              </div>
            </div>
            <Link to="/configuracoes?tab=integracoes"><Button>Configurar integração</Button></Link>
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Alertas de SLA" description="Atrasadas e próximas do prazo" />
          <div className="divide-y divide-line/60">
            {allAlerts.length === 0 ? (
              <EmptyState title="Nenhum alerta de SLA" description="Não há prazos vencidos ou próximos no momento." />
            ) : (
              allAlerts.map((item) => (
                <Link key={item.id} to={`/ocorrencias/${item.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-line/20">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{occurrenceCode(item.number)} • {item.customerName}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{formatMinutes(item.remainingMinutes)} • {formatDate(item.dueAt)}</p>
                  </div>
                  <Badge tone={slaTone(item.slaStatus)}>{slaLabel(item.slaStatus)}</Badge>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="SLA pausadas" description="Prazo suspenso por status configurado" />
          <div className="divide-y divide-line/60">
            {attention.paused.items.length === 0 ? (
              <EmptyState title="Nenhuma ocorrência pausada" description="O prazo volta a correr quando o status é alterado." />
            ) : (
              attention.paused.items.map((item) => (
                <Link key={item.id} to={`/ocorrencias/${item.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-line/20">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{item.code} • {item.customerName}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{item.status} • {formatDate(item.dueAt)}</p>
                  </div>
                  <Badge tone="neutral">{item.sla.pausedMinutes}min pausadas</Badge>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Documentos de motoristas" description="Pendências e validades próximas" />
          <div className="divide-y divide-line/60">
            {driversToReview.size === 0 ? (
              <EmptyState title="Nenhuma pendência" description="Não há documentos pendentes ou próximos do vencimento." />
            ) : (
              [...driversToReview.values()].map((driver) => (
                <Link key={driver.id} to={`/motoristas/${driver.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-line/20">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{driver.name}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{driver.status} • {driver.pendingDocuments} pendente(s)</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {driver.pendingDocuments > 0 && <Badge tone="warning">Pendente</Badge>}
                    {(driver.cnhAlert === 'soon' || driver.expiringDocuments > 0) && <Badge tone="warning">Vencendo</Badge>}
                    {driver.cnhAlert === 'expired' && <Badge tone="danger">Vencida</Badge>}
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Ocorrências recebidas"
            description="Quantidade por período"
            action={
              <Tabs
                tabs={[
                  { id: 'day', label: 'Dias' },
                  { id: 'week', label: 'Semanas' },
                  { id: 'month', label: 'Meses' }
                ]}
                active={chartMode}
                onChange={(id) => setChartMode(id as 'day' | 'week' | 'month')}
              />
            }
          />
          <div className="h-72 p-4">
            {hasOccurrences ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="occurrences" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--card))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" stroke="#3B82F6" fill="url(#occurrences)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="Sem ocorrências ainda" description="O gráfico será preenchado com dados reais assim que ocorrências forem registradas." />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Por categoria" description="Tipos de problemas mais frequentes" />
          <div className="h-72 p-4">
            {data.charts.categories.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.charts.categories} dataKey="total" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={3}>
                    {data.charts.categories.map((entry, index) => <Cell key={entry.label} fill={pieColors[index % pieColors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'rgb(var(--card))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="Sem categorias em uso" description="A distribuição aparece aqui quando houver ocorrências." />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Resumo inteligente" description={data.summarySource === 'ai' ? 'Gerado pela IA configurada' : 'Calculado a partir de dados reais'} />
          <div className="p-5">
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <p className="text-sm leading-relaxed text-muted">{data.summary}</p>
            </div>
            {data.summarySource !== 'ai' && (
              <p className="mt-4 text-[11px] text-muted">Configure OPENAI_API_KEY para habilitar resumos por IA. Nada é simulado.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Próximos vencimentos" description="Ocorrências que precisam de atenção" />
          <div className="divide-y divide-line/60">
            {data.upcoming.length === 0 ? (
              <EmptyState title="Nenhum prazo próximo" description="Não há ocorrências com prazo pendente no momento." />
            ) : (
              data.upcoming.map((item) => (
                <Link key={item.id} to={`/ocorrencias/${item.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-line/20">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{item.code} • {item.customer_name}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{formatDate(item.due_at)}</p>
                  </div>
                  <Badge tone={item.priority === 'Urgente' ? 'danger' : item.priority === 'Alta' ? 'warning' : 'info'}>{item.priority}</Badge>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Atividades recentes" description="Últimas ações registradas" />
          <div className="divide-y divide-line/60">
            {data.activities.length === 0 ? (
              <EmptyState title="Sem atividades" description="As ações do sistema aparecerão aqui." />
            ) : (
              data.activities.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-5 py-3">
                  <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink">{item.action.replace(/_/g, ' ')}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{item.user_name} • {relativeTime(item.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Volume por mês" />
        <div className="h-64 p-4">
          {data.charts.month.some((item) => item.total > 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.month} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'rgb(var(--card))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="total" fill="#22C55E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="Sem dados mensais" description="O histórico real será exibido aqui." />
          )}
        </div>
      </Card>
    </div>
  );
}
