import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Paperclip } from 'lucide-react';
import { api, cpfMask, downloadFile, formatDate, relativeTime } from '../lib/api';
import { useApp } from '../context/AppContext';
import type { Driver } from '../lib/types';
import { DRIVER_STATUSES } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton } from '../components/ui';

interface DocumentItem { id: string; name: string; mime: string; size: number; type: string; created_at: string }
interface HistoryItem { id: string; action: string; details: string | null; created_at: string; user_name: string }

export function DriverDetailPage() {
  const { id } = useParams();
  const { toast } = useApp();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [docType, setDocType] = useState('CNH');
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try {
      const data = await api<{ driver: Driver; documents: DocumentItem[]; history: HistoryItem[] }>(`/drivers/${id}`);
      setDriver(data.driver);
      setDocuments(data.documents);
      setHistory(data.history);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar motorista.', 'error');
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (!driver) return <Skeleton className="h-96 w-full" />;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const body = new FormData();
    body.append('file', file);
    body.append('type', docType);
    try {
      await api(`/drivers/${driver.id}/documents`, { method: 'POST', body });
      toast('Documento adicionado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao enviar documento.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const changeStatus = async (status: string) => {
    try {
      await api(`/drivers/${driver.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast('Status atualizado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao atualizar status.', 'error');
    }
  };

  const fields: Array<[string, string | null]> = [
    ['CPF', cpfMask(driver.cpf)],
    ['Telefone', driver.phone],
    ['E-mail', driver.email],
    ['Nascimento', driver.birthDate ? formatDate(driver.birthDate, false) : null],
    ['Endereço', driver.address],
    ['Cidade/UF', driver.city && driver.state ? `${driver.city}/${driver.state}` : null],
    ['CEP', driver.zip],
    ['CNH', driver.cnhNumber],
    ['Categoria', driver.cnhCategory],
    ['Validade da CNH', driver.cnhExpiry ? formatDate(driver.cnhExpiry, false) : null],
    ['Cadastrado por', driver.authorName],
    ['Cadastro', formatDate(driver.createdAt)]
  ];

  return (
    <div>
      <PageHeader
        title={driver.name}
        description="Cadastro, documentos e histórico do motorista"
        breadcrumbs={[{ label: 'Motoristas', to: '/motoristas' }, { label: driver.name }]}
        actions={<Link to="/motoristas"><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Voltar</Button></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Dados cadastrais" action={<Badge tone={driver.status === 'Aprovado' ? 'success' : driver.status === 'Reprovado' ? 'danger' : 'warning'}>{driver.status}</Badge>} />
            <div className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              {fields.map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
                  <p className="mt-1 text-sm text-ink">{value || '—'}</p>
                </div>
              ))}
              {driver.notes && (
                <div className="sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted">Observações</p>
                  <p className="mt-1 text-sm text-ink">{driver.notes}</p>
                </div>
              )}
            </div>
            <div className="border-t border-line p-5">
              <Field label="Alterar status">
                <Select value={driver.status} onChange={(event) => void changeStatus(event.target.value)}>
                  {DRIVER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Histórico de alterações" />
            <div className="divide-y divide-line/60">
              {history.length === 0 ? (
                <EmptyState title="Sem histórico" description="As alterações aparecerão aqui." />
              ) : (
                history.map((item) => (
                  <div key={item.id} className="px-5 py-3">
                    <p className="text-xs font-medium text-ink">{item.action}</p>
                    {item.details && <p className="mt-0.5 text-[11px] text-muted">{item.details}</p>}
                    <p className="mt-1 text-[10px] text-muted">{item.user_name} • {relativeTime(item.created_at)}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Documentos" description="Arquivos privados com acesso controlado" />
            <div className="space-y-3 border-b border-line p-4">
              <div className="grid grid-cols-2 gap-2">
                <Select value={docType} onChange={(event) => setDocType(event.target.value)}>
                  <option>CNH</option>
                  <option>Documento de identificação</option>
                  <option>Comprovante de residência</option>
                  <option>Foto do motorista</option>
                  <option>Outro</option>
                </Select>
                <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-info bg-info/10 text-xs font-medium text-info">
                  {uploading ? 'Enviando...' : <><Paperclip className="h-3.5 w-3.5" /> Anexar</>}
                  <input type="file" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
                </label>
              </div>
            </div>
            <div className="divide-y divide-line/60">
              {documents.length === 0 ? (
                <EmptyState icon={<FileText className="h-5 w-5" />} title="Nenhum documento" description="Anexe CNH e demais documentos exigidos." />
              ) : (
                documents.map((document) => (
                  <div key={document.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-ink">{document.name}</p>
                      <p className="text-[11px] text-muted">{document.type} • {(document.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <Button variant="ghost" size="icon" title="Baixar" onClick={() => void downloadFile(`/files/${document.id}/download`, document.name)}><Download className="h-4 w-4" /></Button>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
