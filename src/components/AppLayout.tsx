import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  CheckCheck,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Files,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserCircle,
  Users,
  X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Avatar } from './Avatar';
import { api, relativeTime } from '../lib/api';
import { Badge, Button, cx } from './ui';

const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { to: '/ocorrencias', label: 'Ocorrências SAC', icon: ClipboardList },
  { to: '/motoristas', label: 'Motoristas', icon: Users },
  { to: '/documentos', label: 'Documentos', icon: Files },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/assistente', label: 'Assistente IA', icon: Sparkles },
  { to: '/notificacoes', label: 'Notificações', icon: Bell },
  { to: '/configuracoes', label: 'Configurações', icon: Settings }
];

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  to: string;
}

export function AppLayout() {
  const { user, logout, theme, toggleTheme, sidebarCollapsed, toggleSidebar, notifications, unread, refreshNotifications, markAllRead } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
    setSearchOpen(false);
    setQuery('');
  }, [location.pathname]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const data = await api<{ groups: Array<{ label: string; items: SearchResult[] }> }>(`/search?q=${encodeURIComponent(query)}`);
        setResults(data.groups.flatMap((group) => group.items));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const crumbs = location.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const found = navigation.find((item) => item.to !== '/' && item.to.endsWith(segment));
      return { label: found?.label ?? segment.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) };
    });

  const widthClass = sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-[248px]';

  return (
    <div className="min-h-screen bg-canvas">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-sidebar transition-all duration-200',
          widthClass,
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className={cx('flex h-16 items-center gap-3 border-b border-line px-4', sidebarCollapsed && 'lg:justify-center lg:px-2')}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info text-sm font-bold text-white">CO</div>
          {!sidebarCollapsed && (
            <div className="min-w-0 lg:block" style={mobileOpen ? { display: 'block' } : undefined}>
              <p className="truncate text-sm font-semibold text-ink">Central Operacional</p>
              <p className="truncate text-[11px] text-muted">{user?.companyName ?? 'Gestão operacional'}</p>
            </div>
          )}
          <button className="ml-auto text-muted lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-info/10 text-info' : 'text-muted hover:bg-line/30 hover:text-ink',
                  sidebarCollapsed && 'lg:justify-center lg:px-0'
                )
              }
              title={sidebarCollapsed ? item.label : undefined}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {(!sidebarCollapsed || mobileOpen) && <span className="lg:inline">{item.label}</span>}
              {item.to === '/notificacoes' && unread > 0 && (!sidebarCollapsed || mobileOpen) && (
                <Badge tone="danger" className="ml-auto">{unread}</Badge>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <div className={cx('flex items-center gap-2', sidebarCollapsed && 'lg:justify-center')}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/ocorrencias?new=1')}
              title="Nova ocorrência"
            >
              <Plus className="h-4 w-4" />
            </Button>
            {!sidebarCollapsed && <span className="text-[11px] text-muted">Ação rápida</span>}
            <button
              onClick={toggleSidebar}
              className="ml-auto hidden text-muted hover:text-ink lg:block"
              title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            >
              {sidebarCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>

      <div className={cx('transition-all duration-200', sidebarCollapsed ? 'lg:pl-[76px]' : 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur sm:px-6">
          <button className="text-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu className="h-5 w-5" />
          </button>

          <div ref={searchRef} className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Buscar ocorrências, motoristas, pedidos..."
              className="h-10 w-full rounded-lg border border-line bg-card pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-info focus:ring-2 focus:ring-info/15"
            />
            {searchOpen && results.length > 0 && (
              <div className="absolute left-0 right-0 top-12 z-30 max-h-96 overflow-auto rounded-xl border border-line bg-card p-2 shadow-2xl">
                {results.map((result) => (
                  <button
                    key={`${result.to}-${result.id}`}
                    onClick={() => {
                      navigate(result.to);
                      setSearchOpen(false);
                    }}
                    className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-line/30"
                  >
                    <span className="text-sm text-ink">{result.title}</span>
                    <span className="truncate text-[11px] text-muted">{result.subtitle}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <div className="relative">
              <Button variant="ghost" size="icon" onClick={() => setNotificationsOpen((open) => !open)} title="Notificações">
                <Bell className="h-4 w-4" />
                {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />}
              </Button>
              {notificationsOpen && (
                <div className="absolute right-0 top-12 z-30 w-[min(380px,calc(100vw-2rem))] rounded-xl border border-line bg-card shadow-2xl">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <span className="text-sm font-semibold">Notificações</span>
                    <button
                      className="flex items-center gap-1 text-[11px] text-muted hover:text-ink"
                      onClick={() => void markAllRead()}
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Marcar todas
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-muted">Nenhuma notificação.</p>
                    ) : (
                      notifications.slice(0, 12).map((item) => (
                        <button
                          key={item.id}
                          onClick={async () => {
                            await api(`/notifications/${item.id}/read`, { method: 'PATCH' });
                            await refreshNotifications();
                          }}
                          className="flex w-full flex-col items-start gap-1 border-b border-line/60 px-4 py-3 text-left last:border-0 hover:bg-line/20"
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="text-xs font-medium text-ink">{item.title}</span>
                            {!item.read_at && <span className="h-1.5 w-1.5 rounded-full bg-info" />}
                          </div>
                          {item.body && <span className="line-clamp-2 text-[11px] text-muted">{item.body}</span>}
                          <span className="text-[10px] text-muted">{relativeTime(item.created_at)}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <button
                    onClick={() => navigate('/notificacoes')}
                    className="w-full border-t border-line px-4 py-2.5 text-center text-xs font-medium text-info hover:bg-line/20"
                  >
                    Ver todas
                  </button>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setProfileOpen((open) => !open)}
                className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 hover:bg-line/30"
              >
                <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-info/15 text-xs font-semibold text-info">
                  <Avatar src={user?.avatarUrl ?? null} name={user?.name ?? ''} className="flex h-full w-full items-center justify-center" />
                </span>
                <span className="hidden max-w-[120px] truncate text-xs font-medium sm:block">{user?.name}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-12 z-30 w-56 rounded-xl border border-line bg-card p-1.5 shadow-2xl">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-medium text-ink">{user?.name}</p>
                    <p className="truncate text-[11px] text-muted">{user?.email}</p>
                  </div>
                  <button onClick={() => navigate('/configuracoes?tab=seguranca')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-line/30 hover:text-ink">
                    <KeyRound className="h-3.5 w-3.5" /> Segurança
                  </button>
                  <button onClick={() => navigate('/configuracoes')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-line/30 hover:text-ink">
                    <UserCircle className="h-3.5 w-3.5" /> Configurações
                  </button>
                  <button onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-danger hover:bg-danger/10">
                    <LogOut className="h-3.5 w-3.5" /> Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          {crumbs.length > 0 && (
            <div className="mb-4 flex items-center gap-1.5 text-[11px] text-muted">
              <Link to="/" className="hover:text-ink">Início</Link>
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                  <span>/</span>
                  <span className="capitalize text-ink/70">{crumb.label}</span>
                </span>
              ))}
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
