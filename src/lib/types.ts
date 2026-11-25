export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'employee';
  avatarUrl: string | null;
  theme: 'dark' | 'light';
  companyId: string;
  companyName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Occurrence {
  id: string;
  number: number;
  code: string;
  customerName: string;
  customerPhone: string | null;
  orderCode: string | null;
  trackingCode: string | null;
  recipientName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  description: string;
  receivedAt: string;
  origin: string;
  responsible: string | null;
  priority: 'Baixa' | 'Normal' | 'Alta' | 'Urgente';
  dueAt: string | null;
  status: string;
  closedAt: string | null;
  overdue: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
}

export interface Category {
  id: string;
  name: string;
  sla_hours: number;
  active: boolean;
  created_at: string;
}

export interface Driver {
  id: string;
  name: string;
  cpf: string;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  cnhNumber: string | null;
  cnhCategory: string | null;
  cnhExpiry: string | null;
  cnhAlert: 'expired' | 'soon' | 'ok' | 'none';
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
  authorName: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export interface WhatsappStatus {
  provider: string;
  configured: boolean;
  status: string;
  displayNumber: string | null;
  lastSyncAt: string | null;
  notes: string | null;
  missing: string[];
  webhookUrl: string;
  groupSupport: 'unknown' | 'yes' | 'no';
  canReadGroups: boolean;
  officialOnly: boolean;
}

export const OCCURRENCE_STATUSES = [
  'Nova ocorrência',
  'Em análise',
  'Em andamento',
  'Aguardando retorno',
  'Aguardando cliente',
  'Aguardando transportadora',
  'Resolvida',
  'Encerrada'
] as const;

export const PRIORITIES = ['Baixa', 'Normal', 'Alta', 'Urgente'] as const;

export const DRIVER_STATUSES = [
  'Novo cadastro',
  'Aguardando documentos',
  'Documentação incompleta',
  'Em análise',
  'Aprovado',
  'Reprovado',
  'Inativo'
] as const;
