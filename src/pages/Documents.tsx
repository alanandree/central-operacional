import { useEffect, useState } from 'react';
import { Files, Search } from 'lucide-react';
import { api, downloadFile, formatDate } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from '../components/ui';

interface DocumentItem {
  link_id: string;
  id: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
  owner_name: string;
  source: 'driver' | 'occurrence';
  context: string;
  category: string;
  url: string;
}

export function DocumentsPage() {
  const { toast } = useApp();
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    api<{ items: DocumentItem[]; total: number }>(`/documents?${params}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((error) => toast(error instanceof Error ? error.message : 'Erro ao carregar documentos.', 'error'));
  }, [page, search, type]);

  return (
    <div>
      <PageHeader title="Documentos" description="Todos os arquivos recebidos, organizados por motorista e ocorrência." />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
          <Field label="Buscar">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input className="pl-9" placeholder="Nome do arquivo, motorista ou categoria" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} />
            </div>
          </Field>
          <Field label="Tipo">
            <Select value={type} onChange={(event) => { setPage(1); setType(event.target.value); }}>
              <option value="">Todos</option>
              <option>CNH</option>
              <option>Documento de identificação</option>
              <option>Comprovante de residência</option>
              <option>Foto do motorista</option>
              <option>Outro</option>
              <option>Anexo</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<Files className="h-5 w-5" />} title="Nenhum documento" description="Anexe documentos em motoristas ou ocorrências para vê-los aqui." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Arquivo</th>
                  <th className="px-4 py-3 font-medium">Contexto</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Recebido</th>
                  <th className="px-4 py-3 font-medium">Tamanho</th>
                  <th className="px-5 py-3 text-right font-medium">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {items.map((item) => (
                  <tr key={`${item.source}-${item.link_id}`} className="hover:bg-line/20">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink">{item.name}</p>
                      <p className="text-[11px] text-muted">{item.mime}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={item.source === 'driver' ? 'info' : 'success'}>{item.context}</Badge>
                      <p className="mt-1 text-[11px] text-muted">{item.owner_name}</p>
                    </td>
                    <td className="px-4 py-3 text-muted">{item.category}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDate(item.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-muted">{(item.size / 1024).toFixed(0)} KB</td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" onClick={() => void downloadFile(`/files/${item.id}/download`, item.name)}>Baixar</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 20 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
            <span>{total} documentos • página {page}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button>
              <Button size="sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
