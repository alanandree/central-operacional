import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, clearToken, getToken, setToken } from '../lib/api';
import type { NotificationItem, User } from '../lib/types';

type Theme = 'dark' | 'light';
type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface AppContextValue {
  user: User | null;
  loading: boolean;
  theme: Theme;
  toggleTheme: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  notifications: NotificationItem[];
  unread: number;
  refreshNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
  toast: (message: string, kind?: ToastKind) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('co_theme') as Theme) || 'dark');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('co_theme', theme);
  }, [theme]);

  const refreshNotifications = async () => {
    if (!getToken()) return;
    try {
      const data = await api<{ notifications: NotificationItem[]; unread: number }>('/notifications');
      setNotifications(data.notifications);
      setUnread(data.unread);
    } catch {
      setNotifications([]);
      setUnread(0);
    }
  };

  const refreshUser = async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: User }>('/auth/me');
      setUser(data.user);
      setTheme(data.user.theme);
      await refreshNotifications();
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshUser();
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void refreshNotifications(), 30000);
    return () => window.clearInterval(timer);
  }, [user]);

  const toast = (message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4000);
  };

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      loading,
      theme,
      toggleTheme: () =>
        setTheme((current) => {
          const next = current === 'dark' ? 'light' : 'dark';
          void api('/auth/me', { method: 'PATCH', body: JSON.stringify({ theme: next }) })
            .then(() => setUser((existing) => (existing ? { ...existing, theme: next } : existing)))
            .catch(() => undefined);
          return next;
        }),
      login: async (email, password) => {
        const data = await api<{ token: string; user: User }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        setToken(data.token);
        setUser(data.user);
        setTheme(data.user.theme);
        setLoading(false);
        await refreshNotifications();
      },
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST' });
        } catch {
          clearToken();
        }
        clearToken();
        setUser(null);
        setNotifications([]);
        setUnread(0);
      },
      refreshUser,
      sidebarCollapsed,
      toggleSidebar: () => setSidebarCollapsed((current) => !current),
      notifications,
      unread,
      refreshNotifications,
      markAllRead: async () => {
        await api('/notifications/read-all', { method: 'PATCH' });
        await refreshNotifications();
      },
      toast
    }),
    [user, loading, theme, sidebarCollapsed, notifications, unread]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto animate-fadeUp rounded-xl border px-4 py-3 text-sm shadow-soft ${
              item.kind === 'error'
                ? 'border-danger/40 bg-danger/10 text-danger'
                : item.kind === 'info'
                  ? 'border-info/40 bg-info/10 text-info'
                  : 'border-success/40 bg-success/10 text-success'
            }`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp deve ser usado dentro de AppProvider.');
  return context;
}
