import { useEffect, useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { Occurrence } from '../lib/types';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from '../components/ui';

interface AiStatus {
  configured: boolean;
  provider: string;
  model: string | null;
  capabilities: string[];
}

export function AssistantPage() {
  const { toast } = useApp();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);
  const [summary, setSummary] = useState('');
  const [reply, setReply] = useState('');
  const [occurrenceId, setOccurrenceId] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    Promise.all([
      api<AiStatus>('/ai/status'),
      api<{ items: Occurrence[] }>('/occurrences?limit=100')
    ])
      .then(([statusData, occurrenceData]) => {
        setStatus(statusData);
        setOccurrences(occurrenceData.items);
      })
      .catch((error) => toast(error instanceof Error ? error.message : 'Erro ao carregar assistente.', 'error'));
  }, []);

  const run = async (action: 'analyze' | 'summarize' | 'reply') => {
    setBusy(action);
    try {
      if (action === 'analyze') {
        const data = await api<{ suggestion: any }>('/ai/analyze', { method: 'POST', body: JSON.stringify({ message }) });
        setAnalysis(data.suggestion);
      }
      if (action === 'summarize') {
        const data = await api<{ summary: string }>('/ai/summarize', { method: 'POST', body: JSON.stringify({ occurrenceId: occurrenceId || undefined, text: occurrenceId ? undefined : message }) });
        setSummary(data.summary);
      }
      if (action === 'reply') {
        const data = await api<{ reply: string }>('/ai/reply', { method: 'POST', body: JSON.stringify({ message }) });
        setReply(data.reply);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao processar com IA.', 'error');
    } finally {
      setBusy('');
    }
  };

  if (!status) return null;

  return (
    <div>
      <PageHeader title="Assistente IA" description="Automatize análise, resumos e respostas com inteligência artificial." />

      <Card className="mb-6">
        <CardHeader title="Status" action={<Badge tone={status.configured ? 'success' : 'warning'}>{status.configured ? 'Ativa' : 'Desativada'}</Badge>} />
        <div className="p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div><p className="text-[11px] uppercase text-muted">Provedor</p><p className="mt-1 text-sm text-ink">{status.provider}</p></div>
            <div><p className="text-[11px] uppercase text-muted">Modelo</p><p className="mt-1 text-sm text-ink">{status.model ?? '—'}</p></div>
            <div><p className="text-[11px] uppercase text-muted">Uso</p><p className="mt-1 text-sm text-ink">Humano confirma todas as ações</p></div>
          </div>
          {!status.configured && (
            <div className="mt-4 flex gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              <div className="text-xs text-muted">
                <p className="font-medium text-warning">IA desativada.</p>
                <p className="mt-1">Defina OPENAI_API_KEY e reinicie o servidor. Nenhuma análise é simulada.</p>
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {status.capabilities.map((capability) => <Badge key={capability} tone="info">{capability}</Badge>)}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Analisar mensagem" description="A IA sugere campos, mas nunca cria a ocorrência sozinha." />
          <div className="space-y-4 p-5">
            <Field label="Mensagem recebida"><Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Boa tarde, o pedido 829104 não chegou ao destinatário e já consta como entregue." /></Field>
            <Button variant="primary" disabled={!status.configured || message.length < 5 || Boolean(busy)} onClick={() => void run('analyze')}>
              <Sparkles className="h-4 w-4" /> {busy === 'analyze' ? 'Analisando...' : 'Analisar'}
            </Button>
            {analysis && (
              <div className="rounded-lg border border-line bg-canvas p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-ink">Sugestão</p>
                  <Badge tone="warning">confirmação humana</Badge>
                </div>
                <pre className="overflow-x-auto text-[11px] leading-relaxed text-muted">{JSON.stringify(analysis, null, 2)}</pre>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Resumir ocorrência" description="Resumo do histórico real" />
            <div className="space-y-4 p-5">
              <Field label="Ocorrência">
                <Select value={occurrenceId} onChange={(event) => setOccurrenceId(event.target.value)}>
                  <option value="">Nenhuma</option>
                  {occurrences.map((item) => <option key={item.id} value={item.id}>{item.code} • {item.customerName}</option>)}
                </Select>
              </Field>
              {!occurrenceId && <Field label="Ou cole um texto"><Textarea value={message} onChange={(event) => setMessage(event.target.value)} /></Field>}
              <Button disabled={!status.configured || (!occurrenceId && message.length < 10) || Boolean(busy)} onClick={() => void run('summarize')}>
                {busy === 'summarize' ? 'Resumindo...' : 'Gerar resumo'}
              </Button>
              {summary && <p className="rounded-lg border border-line bg-canvas p-4 text-xs leading-relaxed text-muted">{summary}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Sugerir resposta" />
            <div className="space-y-4 p-5">
              <Button disabled={!status.configured || message.length < 5 || Boolean(busy)} onClick={() => void run('reply')}>
                {busy === 'reply' ? 'Gerando...' : 'Sugerir resposta'}
              </Button>
              {reply && <p className="rounded-lg border border-line bg-canvas p-4 text-xs leading-relaxed text-muted">{reply}</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
