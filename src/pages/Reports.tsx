import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, FileText, Sparkles } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Skeleton, StatCard, Tabs } from '../components/ui';

interface SacReport {
  period: { from: string; to: string };
  total: number;
  resolved: number;
  overdue: number;
  averageResolutionHours: number | null;
  onTimePercent: number;
  byCategory: Array<{ label: string; total: number }>;
  byStatus: Array<{ label: string; total: number }>;
}

interface DriverReport {
  period: { from: string; to: string };
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  incompleteDocs: number;
  expiringCnh: number;
  byStatus: Array<{ label: string; total: number }>;
}

interface AiReport {
  report: string;
  facts: string;
  source: 'ia' | 'dados';
  periodDays: number;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'sac' | 'drivers' | 'ia'>('sac');
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [periodDays, setPeriodDays] = useState(30);
  const [sac, setSac] = useState<SacReport | null>(null);
  const [drivers, setDrivers] = useState<DriverReport | null>(null);
  const [aiReport, setAiReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const query = `?from=${from}&to=${to}`;
    Promise.all([api<SacReport>(`/reports/sac${query}`), api<DriverReport>(`/reports/drivers${query}`)])
      .then(([sacData, driverData]) => {
        setSac(sacData);
        setDrivers(driverData);
      })
      .catch((error) => toast(error instanceof Error ? error.message : 'Erro ao carregar relatórios.', 'error'))
      .finally(() => setLoading(false));
  }, [from, to]);

  const exportFile = async (path: string, filename: string) => {
    try {
      await downloadFile(`${path}?from=${from}&to=${to}`, filename);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao exportar.', 'error');
    }
  };

  const generateAiReport = async () => {
    setAiLoading(true);
    try {
      const data = await api<AiReport>('/ai/report', {
        method: 'POST',
        body: JSON.stringify({ periodDays: Number(periodDays) })
      });
      setAiReport(data);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao gerar relatório.', 'error');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="Relatórios" description="Indicadores reais do período selecionado." />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          {tab !== 'ia' && (
            <>
              <Field label="De"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
              <Field label="Até"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
            </>
          )}
          {tab === 'ia' && (
            <Field label="Período (dias)" hint="De 1 a 365 dias">
              <Input type="number" min={1} max={365} value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))} />
            </Field>
          )}
          <div className="ml-auto">
            <Tabs
              tabs={[
                { id: 'sac', label: 'SAC' },
                { id: 'drivers', label: 'Motoristas' },
                { id: 'ia', label: 'Relatório executivo' }
              ]}
              active={tab}
              onChange={(id) => setTab(id as 'sac' | 'drivers' | 'ia')}
            />
          </div>
        </div>
      </Card>

      {tab === 'sac' && (loading && !sac ? <Skeleton className="h-96" /> : sac && (
        <div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total" value={sac.total} icon={<FileText className="h-4 w-4" />} tone="info" />
            <StatCard label="Resolvidas" value={sac.resolved} icon={<FileText className="h-4 w-4" />} tone="success" />
            <StatCard label="Atrasadas" value={sac.overdue} icon={<FileText className="h-4 w-4" />} tone="danger" />
            <StatCard label="Dentro do prazo" value={`${sac.onTimePercent}%`} icon={<FileText className="h-4 w-4" />} tone="warning" hint={`Tempo médio: ${sac.averageResolutionHours ?? 0}h`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Ocorrências por categoria" />
              <div className="h-72 p-4">
                {sac.byCategory.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sac.byCategory} layout="vertical" margin={{ left: 40, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} />
                      <YAxis type="category" dataKey="label" width={110} tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: 'rgb(var(--card))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="total" fill="#3B82F6" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="Sem dados no período" description="Ajuste o filtro de datas." />}
              </div>
            </Card>
            <Card>
              <CardHeader title="Ocorrências por status" />
              <div className="h-72 p-4">
                {sac.byStatus.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sac.byStatus} margin={{ left: -20, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: 'rgb(var(--muted))', fontSize: 9 }} interval={0} angle={-20} height={60} />
                      <YAxis allowDecimals={false} tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: 'rgb(var(--card))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="total" fill="#22C55E" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="Sem dados no período" description="Ajuste o filtro de datas." />}
              </div>
            </Card>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => void exportFile('/reports/sac.csv', 'relatorio-sac.csv')}><Download className="h-4 w-4" /> CSV</Button>
            <Button onClick={() => void exportFile('/reports/sac.pdf', 'relatorio-sac.pdf')}><FileText className="h-4 w-4" /> PDF</Button>
          </div>
        </div>
      ))}

      {tab === 'drivers' && (loading && !drivers ? <Skeleton className="h-96" /> : drivers && (
        <div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total" value={drivers.total} icon={<FileText className="h-4 w-4" />} tone="info" />
            <StatCard label="Pendentes" value={drivers.pending} icon={<FileText className="h-4 w-4" />} tone="warning" />
            <StatCard label="Aprovados" value={drivers.approved} icon={<FileText className="h-4 w-4" />} tone="success" />
            <StatCard label="Documentos incompletos" value={drivers.incompleteDocs} icon={<FileText className="h-4 w-4" />} tone="danger" hint={`CNHs próximas: ${drivers.expiringCnh}`} />
          </div>

          <Card className="mt-6">
            <CardHeader title="Motoristas por status" />
            <div className="h-80 p-4">
              {drivers.byStatus.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={drivers.byStatus} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'rgb(var(--muted))', fontSize: 9 }} interval={0} angle={-15} height={60} />
                    <YAxis allowDecimals={false} tick={{ fill: 'rgb(var(--muted))', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: 'rgb(var(--card))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="total" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState title="Sem dados no período" description="Ajuste o filtro de datas." />}
            </div>
          </Card>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => void exportFile('/reports/drivers.csv', 'relatorio-motoristas.csv')}><Download className="h-4 w-4" /> CSV</Button>
            <Button onClick={() => void exportFile('/reports/drivers.pdf', 'relatorio-motoristas.pdf')}><FileText className="h-4 w-4" /> PDF</Button>
          </div>
        </div>
      ))}

      {tab === 'ia' && (
        <Card>
          <CardHeader
            title="Relatório executivo"
            description="Gerado a partir de fatos reais; texto por IA apenas se configurada"
            action={<Button variant="primary" disabled={aiLoading || periodDays < 1 || periodDays > 365} onClick={() => void generateAiReport()}>{aiLoading ? 'Gerando...' : 'Gerar relatório'}</Button>}
          />
          <div className="p-5">
            {aiLoading ? (
              <Skeleton className="h-48" />
            ) : aiReport ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={aiReport.source === 'ia' ? 'success' : 'info'}>
                    {aiReport.source === 'ia' ? 'IA configurada' : 'Dados reais e regras'}
                  </Badge>
                  <span className="text-[11px] text-muted">Últimos {aiReport.periodDays} dias</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{aiReport.report}</p>
                <div className="rounded-lg border border-line bg-canvas p-4">
                  <p className="text-xs font-medium text-muted">Fatos utilizados</p>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-muted">{aiReport.facts}</pre>
                </div>
                {aiReport.source !== 'ia' && (
                  <p className="text-[11px] text-muted">A IA não está configurada; o texto foi montado somente com fatos reais e regras do servidor.</p>
                )}
              </div>
            ) : (
              <EmptyState icon={<Sparkles className="h-5 w-5" />} title="Nenhum relatório gerado" description="Escolha o período em dias e gere um resumo a partir de dados reais." />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
