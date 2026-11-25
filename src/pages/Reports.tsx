import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, FileText } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, StatCard, Tabs } from '../components/ui';

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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'sac' | 'drivers'>('sac');
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [sac, setSac] = useState<SacReport | null>(null);
  const [drivers, setDrivers] = useState<DriverReport | null>(null);

  useEffect(() => {
    const query = `?from=${from}&to=${to}`;
    Promise.all([api<SacReport>(`/reports/sac${query}`), api<DriverReport>(`/reports/drivers${query}`)])
      .then(([sacData, driverData]) => {
        setSac(sacData);
        setDrivers(driverData);
      })
      .catch((error) => toast(error instanceof Error ? error.message : 'Erro ao carregar relatórios.', 'error'));
  }, [from, to]);

  const exportFile = async (path: string, filename: string) => {
    try {
      await downloadFile(`${path}?from=${from}&to=${to}`, filename);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao exportar.', 'error');
    }
  };

  return (
    <div>
      <PageHeader title="Relatórios" description="Indicadores reais do período selecionado." />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="De"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
          <Field label="Até"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
          <div className="ml-auto"><Tabs tabs={[{ id: 'sac', label: 'SAC' }, { id: 'drivers', label: 'Motoristas' }]} active={tab} onChange={(id) => setTab(id as 'sac' | 'drivers')} /></div>
        </div>
      </Card>

      {tab === 'sac' && sac && (
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
      )}

      {tab === 'drivers' && drivers && (
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
      )}
    </div>
  );
}
