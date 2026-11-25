import { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, FileText, RefreshCw, Search, Sparkles } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { AiStatus, DelaysResponse, Occurrence } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from '../components/ui';

function slaTone(status: string): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'overdue' || status === 'breached') return 'danger';
  if (status === 'due_soon') return 'warning';
  if (status === 'met') return 'success';
  return 'info';
}

function sourceBadge(source: string | null | undefined) {
  if (source === 'regras' || source === 'dados') {
    return <Badge tone="warning">Fonte: regras/dados (sem IA)</Badge>;
  }
  if (source === 'ia') return <Badge tone="success">Fonte: IA</Badge>;
  return null;
}

export function AssistantPage() {
  const { toast } = useApp();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [delays, setDelays] = useState<DelaysResponse | null>(null);
  const [delaysLoading, setDelaysLoading] = useState(false);
  const [similarId, setSimilarId] = useState('');
  const [similarText, setSimilarText] = useState('');
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarResult, setSimilarResult] = useState<{ matches: Array<any>; insight: string | null; source: string } | null>(null);
  const [periodDays, setPeriodDays] = useState('30');
  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState<{ report: string; facts: string; source: string; periodDays: number } | null>(null);

  const loadBase = async () => {
    setLoading(true);
    try {
      const [statusData, occData] = await Promise.all([
        api<AiStatus>('/ai/status'),
        api<{ items: Occurrence[] }>('/occurrences?limit=100')
      ]);
      setStatus(statusData);
      setOccurrences(occData.items);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar assistente.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadDelays = async () => {
    setDelaysLoading(true);
    try {
      const data = await api<DelaysResponse>('/ai/delays', { method: 'POST', body: JSON.stringify({}) });
      setDelays(data);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar alertas de SLA.', 'error');
    } finally {
      setDelaysLoading(false);
    }
  };

  useEffect(() => {
    void loadBase();
    void loadDelays();
  }, []);

  const runSimilar = async () => {
    if (!similarId && similarText.trim().length < 5) {
      toast('Selecione uma ocorrência ou informe um texto com pelo menos 5 caracteres.', 'error');
      return;
    }
    setSimilarLoading(true);
    try {
      const data = await api<{ matches: Array<any>; insight: string | null; source: string }>('/ai/similar', {
        method: 'POST',
        body: JSON.stringify(similarId ? { occurrenceId: similarId } : { text: similarText.trim() })
      });
      setSimilarResult(data);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao buscar similaridade.', 'error');
    } finally {
      setSimilarLoading(false);
    }
  };

  const runReport = async () => {
    const days = Number(periodDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      toast('Informe um período entre 1 e 365 dias.', 'error');
      return;
    }
    setReportLoading(true);
    try {
      const data = await api<{ report: string; facts: string; source: string; periodDays: number }>('/ai/report', {
        method: 'POST',
        body: JSON.stringify({ periodDays: days })
      });
      setReport(data);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao gerar relatório.', 'error');
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Assistente IA"
        description="Alertas de SLA, similaridade e relatórios operacionais."
        actions={<Button onClick={() => { void loadBase(); void loadDelays(); }}><RefreshCw className="h-4 w-4" /> Atualizar</Button>}
      />

      <Card className="mb-6">
        <CardHeader
          title="Status da IA"
          description="A IA auxilia, mas não executa ações sem confirmação humana."
          action={status ? <Badge tone={status.configured ? 'success' : 'warning'}>{status.configured ? 'Configurada' : 'Não configurada'}</Badge> : null}
        />
        {loading || !status ? (
          <div className="grid gap-3 p-5 sm:grid-cols-3">{[0,1,2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <div className="p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div><p className="text-[11px] uppercase text-muted">Provedor</p><p className="mt-1 text-sm text-ink">{status.provider}</p></div>
              <div><p className="text-[11px] uppercase text-muted">Modelo</p><p className="mt-1 text-sm text-ink">{status.model || '—'}</p></div>
              <div><p className="text-[11px] uppercase text-muted">Origem</p><p className="mt-1 text-sm text-ink">{status.sourceLabel}</p></div>
            </div>
            {!status.configured && (
              <div className="mt-4 flex gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                <div className="text-xs text-muted">
                  <p className="font-medium text-warning">IA não configurada. Resultados usarão regras/dados reais.</p>
                  <p className="mt-1">Nenhuma resposta será simulada como IA.</p>
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {status.capabilities.map((c) => <Badge key={c} tone="info">{c}</Badge>)}
              {sourceBadge(status.configured ? 'ia' : 'regras')}
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Alertas de SLA"
            description="Ocorrências atrasadas ou próximas do vencimento."
            action={<div className="flex items-center gap-2">{sourceBadge(delays?.source)}<Button size="sm" onClick={() => void loadDelays()} disabled={delaysLoading}>{delaysLoading ? 'Carregando...' : 'Recarregar'}</Button></div>}
          />
          <div className="p-5">
            {delaysLoading && !delays ? (
              <div className="space-y-3">{[0,1,2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : !delays || delays.alerts.length === 0 ? (
              <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="Sem alertas de SLA" description="Nenhuma ocorrência atrasada ou próxima do prazo." />
            ) : (
              <>
                {delays.summary && <div className="mb-4 rounded-lg border border-line bg-canvas p-4 text-sm text-muted"><p className="mb-1 text-xs font-semibold text-ink">Resumo</p>{delays.summary}</div>}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-left text-sm">
                    <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                      <tr><th className="px-3 py-2 font-medium">OC</th><th className="px-3 py-2 font-medium">Cliente</th><th className="px-3 py-2 font-medium">Prioridade</th><th className="px-3 py-2 font-medium">SLA</th><th className="px-3 py-2 font-medium">Prazo</th><th className="px-3 py-2 font-medium">Restante</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {delays.alerts.map((a) => (
                        <tr key={a.id}>
                          <td className="px-3 py-2 text-info">{a.number}</td>
                          <td className="px-3 py-2 text-ink">{a.customerName}<p className="text-[11px] text-muted">{a.category || 'Sem categoria'}</p></td>
                          <td className="px-3 py-2"><Badge tone={a.priority === 'Urgente' ? 'danger' : a.priority === 'Alta' ? 'warning' : 'info'}>{a.priority}</Badge></td>
                          <td className="px-3 py-2"><Badge tone={slaTone(a.slaStatus)}>{a.slaStatus}</Badge></td>
                          <td className="px-3 py-2 text-xs text-muted">{formatDate(a.dueAt)}</td>
                          <td className="px-3 py-2 text-xs text-muted">{a.remainingMinutes} min</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Similaridade de ocorrências" description="Encontre ocorrências com descrição parecida." action={sourceBadge(similarResult?.source)} />
          <div className="space-y-4 p-5">
            <Field label="Ocorrência base">
              <Select value={similarId} onChange={(e) => setSimilarId(e.target.value)}>
                <option value="">Nenhuma (usar texto)</option>
                {occurrences.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.customerName}</option>)}
              </Select>
            </Field>
            {!similarId && <Field label="Texto"><Textarea value={similarText} onChange={(e) => setSimilarText(e.target.value)} placeholder="Descreva o problema para comparar..." /></Field>}
            <Button variant="primary" onClick={() => void runSimilar()} disabled={similarLoading}><Search className="h-4 w-4" /> {similarLoading ? 'Buscando...' : 'Buscar similares'}</Button>
            {similarResult && (
              <div className="space-y-3">
                {similarResult.insight && <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-muted"><p className="mb-1 font-semibold text-ink">Insight</p>{similarResult.insight}</div>}
                {similarResult.matches.length === 0 ? <p className="text-xs text-muted">Nenhuma ocorrência similar encontrada.</p> : (
                  <div className="space-y-2">
                    {similarResult.matches.map((m) => (
                      <div key={m.id} className="rounded-lg border border-line p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-ink">OC {m.number} — {m.customer_name}</span>
                          <Badge tone="info">{m.score}%</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted">{m.description}</p>
                        {m.sharedTerms?.length > 0 && <p className="mt-1 text-[11px] text-muted">Termos: {m.sharedTerms.join(', ')}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Relatório executivo" description="Gera relatório com base em dados reais." action={sourceBadge(report?.source)} />
          <div className="space-y-4 p-5">
            <Field label="Período (dias)"><Input type="number" min={1} max={365} value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} /></Field>
            <Button variant="primary" onClick={() => void runReport()} disabled={reportLoading}><FileText className="h-4 w-4" /> {reportLoading ? 'Gerando...' : 'Gerar relatório'}</Button>
            {report && (
              <div className="space-y-3">
                <div className="rounded-lg border border-line bg-canvas p-4">
                  <p className="mb-2 text-xs font-semibold text-ink">Relatório ({report.periodDays} dias)</p>
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{report.report}</pre>
                </div>
                <details className="rounded-lg border border-line bg-canvas p-3">
                  <summary className="cursor-pointer text-xs font-medium text-ink">Fatos utilizados</summary>
                  <pre className="mt-2 whitespace-pre-wrap text-[11px] text-muted">{report.facts}</pre>
                </details>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
