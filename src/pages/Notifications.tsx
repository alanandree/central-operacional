import { useEffect } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Button, Card, CardHeader, EmptyState, PageHeader } from '../components/ui';

export function NotificationsPage() {
  const { notifications, unread, refreshNotifications, markAllRead } = useApp();

  useEffect(() => {
    void refreshNotifications();
  }, []);

  const markOne = async (id: string) => {
    await api(`/notifications/${id}/read`, { method: 'PATCH' });
    await refreshNotifications();
  };

  return (
    <div>
      <PageHeader
        title="Notificações"
        description={`${unread} não lida(s)`}
        actions={<Button onClick={() => void markAllRead()} disabled={unread === 0}><CheckCheck className="h-4 w-4" /> Marcar todas como lidas</Button>}
      />
      <Card>
        <CardHeader title="Central de notificações" description="Eventos internos do sistema" />
        <div className="divide-y divide-line/60">
          {notifications.length === 0 ? (
            <EmptyState icon={<Bell className="h-5 w-5" />} title="Nenhuma notificação" description="Novas ocorrências, prazos e cadastros aparecerão aqui." />
          ) : (
            notifications.map((item) => (
              <button
                key={item.id}
                onClick={() => void markOne(item.id)}
                className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-line/20"
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read_at ? 'bg-line' : 'bg-info'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{item.title}</p>
                  {item.body && <p className="mt-1 text-xs text-muted">{item.body}</p>}
                  <p className="mt-1 text-[11px] text-muted">{formatDate(item.created_at)}</p>
                </div>
                {!item.read_at && <span className="text-[11px] text-info">marcar como lida</span>}
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
