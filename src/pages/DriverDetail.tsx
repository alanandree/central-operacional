import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Check, Download, FileText, Image, Paperclip, ShieldCheck, X } from 'lucide-react';
import { api, cpfMask, downloadFile, formatDate, relativeTime } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Avatar } from '../components/Avatar';
import type { Driver, DriverDocument, OccurrenceHistoryItem } from '../lib/types';
import { DOCUMENT_STATUSES, DRIVER_STATUSES } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from '../components/ui';

type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

interface RawDriverDocument {
  linkId?: string;
  link_id?: string;
  id: string;
  type: string;
  name: string;
  mime: string;
  size: number;
  expiryDate?: string | null;
  expiry_date?: string | null;
  expiryAlert?: DriverDocument['expiryAlert'];
  status?: DocumentStatus;
  notes?: string | null;
  reviewedAt?: string | null;
  reviewed_at?: string | null;
  createdAt?: string;
  created_at?: string;
  url?: string;
}

interface RawDriverHistory {
  id: string;
  action: string;
  details?: string | null;
  createdAt?: string;
  created_at?: string;
  authorName?: string | null;
  user_name?: string | null;
}

function avatarSrc(url: string | null): string | null {
  return url?.startsWith('/api/') ? url.slice(4) : url;
}

function normalizeDocument(row: RawDriverDocument): DriverDocument {
  return {
    linkId: row.linkId ?? row.link_id ?? row.id,
    id: row.id,
    type: row.type,
    name: row.name,
    mime: row.mime,
    size: Number(row.size) || 0,
    expiryDate: row.expiryDate ?? row.expiry_date ?? null,
    expiryAlert: row.expiryAlert ?? 'none',
    status: row.status ?? 'pendente',
    notes: row.notes ?? null,
    reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null,
    createdAt: row.createdAt ?? row.created_at ?? '',
    url: row.url ?? `/files/${row.id}/download`
  };
}

function normalizeHistory(row: RawDriverHistory): OccurrenceHistoryItem {
  return {
    id: row.id,
    action: row.action,
    details: row.details ?? null,
    createdAt: row.createdAt ?? row.created_at ?? '',
    authorName: row.authorName ?? row.user_name ?? null
  };
}

function driverStatusTone(status: string): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'Aprovado') return 'success';
  if (status === 'Reprovado' || status === 'Inativo') return 'danger';
  if (status === 'Em análise') return 'info';
  if (status === 'Aguardando documentos' || status === 'Documentação incompleta') return 'warning';
  return 'neutral';
}

function documentStatusTone(status: DocumentStatus): 'success' | 'warning' | 'danger' {
  if (status === 'aprovado') return 'success';
  if (status === 'rejeitado') return 'danger';
  return 'warning';
}

function expiryTone(alert: DriverDocument['expiryAlert']): 'success' | 'warning' | 'danger' {
  if (alert === 'expired') return 'danger';
  if (alert === 'soon') return 'warning';
  return 'success';
}

function expiryLabel(alert: DriverDocument['expiryAlert']): string {
  if (alert === 'expired') return 'vencido';
  if (alert === 'soon') return 'vencendo';
  return 'em dia';
}

export function DriverDetailPage() {
  const { id } = useParams();
  const { user, toast } = useApp();
  const isAdmin = user?.role === 'admin';
  const [driver, setDriver] = useState<Driver | null>(null);
  const [documents, setDocuments] = useState<DriverDocument[]>([]);
  const [history, setHistory] = useState<OccurrenceHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState('CNH');
  const [docExpiry, setDocExpiry] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  const load = async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [detail, documentData, historyData] = await Promise.all([
        api<{ driver: Driver; documents?: RawDriverDocument[]; history?: RawDriverHistory[] }>(`/drivers/${id}`),
        api<{ documents: RawDriverDocument[] }>(`/drivers/${id}/documents`),
        api<{ history: RawDriverHistory[] }>(`/drivers/${id}/history`)
      ]);
      setDriver(detail.driver);
      setDocuments((documentData.documents ?? detail.documents ?? []).map(normalizeDocument));
      setHistory((historyData.history ?? detail.history ?? []).map(normalizeHistory));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao carregar motorista.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const uploadDocument = async (file: File | undefined) => {
    if (!file || !id) return;
    setUploading(true);
    const body = new FormData();
    body.append('file', file);
    body.append('type', docType.trim() || 'Outro');
    if (docExpiry) body.append('expiryDate', docExpiry);
    if (docNotes.trim()) body.append('notes', docNotes.trim());
    try {
      await api(`/drivers/${id}/documents`, { method: 'POST', body });
      setDocExpiry('');
      setDocNotes('');
      toast('Documento adicionado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao enviar documento.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const uploadPhoto = async (file: File | undefined) => {
    if (!file || !id) return;
    setUploadingPhoto(true);
    const body = new FormData();
    body.append('photo', file);
    try {
      await api(`/drivers/${id}/photo`, { method: 'POST', body });
      toast('Foto atualizada.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao enviar foto.', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const reviewDocument = async (document: DriverDocument, status: 'aprovado' | 'rejeitado') => {
    if (!id) return;
    setReviewingId(document.linkId);
    try {
      await api(`/drivers/${id}/documents/${document.linkId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes: reviewNotes[document.linkId]?.trim() || undefined })
      });
      toast(status === 'aprovado' ? 'Documento aprovado.' : 'Documento rejeitado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao revisar documento.', 'error');
    } finally {
      setReviewingId(null);
    }
  };

  const downloadDocument = async (document: DriverDocument) => {
    setDownloadingId(document.linkId);
    try {
      await downloadFile(`/files/${document.id}/download`, document.name);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao baixar documento.', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const approveDriver = async () => {
    if (!driver) return;
    setApproving(true);
    try {
      try {
        await api(`/drivers/${driver.id}/approve`, { method: 'POST' });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!/não encontrado|not found/i.test(message)) throw error;
        await api(`/drivers/${driver.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Aprovado' }) });
      }
      toast('Motorista aprovado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao aprovar motorista.', 'error');
    } finally {
      setApproving(false);
    }
  };

  const changeStatus = async (status: string) => {
    if (!driver || status === driver.status) return;
    if (status === 'Aprovado') {
      await approveDriver();
      return;
    }
    setSavingStatus(true);
    try {
      await api(`/drivers/${driver.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast('Status atualizado.');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erro ao atualizar status.', 'error');
    } finally {
      setSavingStatus(false);
    }
  };

  if (!driver) {
    return (
      <div>
        {loading ? <Skeleton className="h-96 w-full" /> : (
          <Card className="p-6">
            <EmptyState icon={<FileText className="h-5 w-5" />} title="Motorista não encontrado" description="Verifique o cadastro na lista de motoristas." action={<Link to="/motoristas"><Button variant="primary">Voltar</Button></Link>} />
          </Card>
        )}
      </div>
    );
  }

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
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/motoristas"><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Voltar</Button></Link>
            {isAdmin && driver.status !== 'Aprovado' && (
              <Button variant="success" onClick={() => void approveDriver()} disabled={approving}>
                <ShieldCheck className="h-4 w-4" /> {approving ? 'Aprovando...' : 'Aprovar motorista'}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Dados cadastrais"
              action={
                <div className="flex items-center gap-3">
                  <Avatar
                    src={avatarSrc(driver.photoUrl)}
                    name={driver.name}
                    className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-line bg-canvas text-xs font-semibold text-info"
                  />
                  <Badge tone={driverStatusTone(driver.status)}>{driver.status}</Badge>
                </div>
              }
            />
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
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Foto do motorista" hint={uploadingPhoto ? 'Enviando...' : 'Imagem opcional'} className="min-w-[220px] flex-1">
                  <Input type="file" accept="image/*" onChange={(event) => void uploadPhoto(event.target.files?.[0])} />
                </Field>
                {isAdmin && (
                  <Field label="Alterar status" className="min-w-[200px]">
                    <Select value={driver.status} disabled={savingStatus || approving} onChange={(event) => void changeStatus(event.target.value)}>
                      {DRIVER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Histórico de alterações" description="Registro das revisões e alterações do cadastro" />
            <div className="divide-y divide-line/60">
              {history.length === 0 ? (
                <EmptyState title="Sem histórico" description="As alterações aparecerão aqui." />
              ) : (
                [...history].reverse().map((item) => (
                  <div key={item.id} className="px-5 py-3">
                    <p className="text-xs font-medium text-ink">{item.action}</p>
                    {item.details && <p className="mt-0.5 text-[11px] text-muted">{item.details}</p>}
                    <p className="mt-1 text-[10px] text-muted">{item.authorName ?? 'Sistema'} • {relativeTime(item.createdAt)}</p>
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
                  <input type="file" className="hidden" onChange={(event) => void uploadDocument(event.target.files?.[0])} />
                </label>
              </div>
              <Input type="date" value={docExpiry} onChange={(event) => setDocExpiry(event.target.value)} aria-label="Validade do documento" />
              <Textarea className="min-h-[64px]" placeholder="Observações do documento" value={docNotes} onChange={(event) => setDocNotes(event.target.value)} />
            </div>
            <div className="divide-y divide-line/60">
              {documents.length === 0 ? (
                <EmptyState icon={<FileText className="h-5 w-5" />} title="Nenhum documento" description="Anexe CNH e demais documentos exigidos." />
              ) : (
                documents.map((document) => (
                  <div key={document.linkId} className="space-y-3 px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{document.name}</p>
                        <p className="mt-1 text-[11px] text-muted">{document.type} • {(document.size / 1024).toFixed(0)} KB • {formatDate(document.createdAt)}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={documentStatusTone(document.status)}>{document.status}</Badge>
                        {document.expiryAlert !== 'none' && (
                          <Badge tone={expiryTone(document.expiryAlert)}>
                            <CalendarClock className="mr-1 h-3 w-3" /> {expiryLabel(document.expiryAlert)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {document.expiryDate && <p className="text-[11px] text-muted">Validade: {formatDate(document.expiryDate, false)}</p>}
                    {document.notes && <p className="text-[11px] text-muted">Observações: {document.notes}</p>}
                    {document.reviewedAt && <p className="text-[11px] text-muted">Revisado em {formatDate(document.reviewedAt)}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => void downloadDocument(document)} disabled={downloadingId === document.linkId}>
                        <Download className="h-3.5 w-3.5" /> {downloadingId === document.linkId ? 'Baixando...' : 'Baixar'}
                      </Button>
                      {isAdmin && (
                        <>
                          <Input
                            className="h-8 max-w-[210px] text-xs"
                            placeholder="Notas da revisão"
                            value={reviewNotes[document.linkId] ?? ''}
                            onChange={(event) => setReviewNotes((current) => ({ ...current, [document.linkId]: event.target.value }))}
                          />
                          <Button size="sm" variant="success" onClick={() => void reviewDocument(document, 'aprovado')} disabled={reviewingId === document.linkId}>
                            <Check className="h-3.5 w-3.5" /> Aprovar
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => void reviewDocument(document, 'rejeitado')} disabled={reviewingId === document.linkId}>
                            <X className="h-3.5 w-3.5" /> Rejeitar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Resumo de prazos" />
            <div className="space-y-3 p-5 text-xs text-muted">
              <div className="flex items-center justify-between gap-3">
                <span><Image className="mr-1 inline h-3.5 w-3.5" /> Foto do motorista</span>
                <Badge tone={driver.photoUrl ? 'success' : 'warning'}>{driver.photoUrl ? 'enviada' : 'ausente'}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span><FileText className="mr-1 inline h-3.5 w-3.5" /> Documentos pendentes</span>
                <Badge tone={driver.pendingDocuments > 0 ? 'warning' : 'success'}>{driver.pendingDocuments}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span><CalendarClock className="mr-1 inline h-3.5 w-3.5" /> Documentos vencendo</span>
                <Badge tone={driver.expiringDocuments > 0 ? 'danger' : 'success'}>{driver.expiringDocuments}</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
