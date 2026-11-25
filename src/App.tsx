import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { OccurrencesPage } from './pages/Occurrences';
import { OccurrenceDetailPage } from './pages/OccurrenceDetail';
import { DriversPage } from './pages/Drivers';
import { DriverDetailPage } from './pages/DriverDetail';
import { DocumentsPage } from './pages/Documents';
import { WhatsAppPage } from './pages/WhatsApp';
import { AssistantPage } from './pages/Assistant';
import { ReportsPage } from './pages/Reports';
import { NotificationsPage } from './pages/Notifications';
import { SettingsPage } from './pages/Settings';

function ProtectedLayout() {
  const { user, loading } = useApp();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-muted">
        Carregando Central Operacional...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout />;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/whatsapp" element={<WhatsAppPage />} />
            <Route path="/ocorrencias" element={<OccurrencesPage />} />
            <Route path="/ocorrencias/:id" element={<OccurrenceDetailPage />} />
            <Route path="/motoristas" element={<DriversPage />} />
            <Route path="/motoristas/:id" element={<DriverDetailPage />} />
            <Route path="/documentos" element={<DocumentsPage />} />
            <Route path="/relatorios" element={<ReportsPage />} />
            <Route path="/assistente" element={<AssistantPage />} />
            <Route path="/notificacoes" element={<NotificationsPage />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
