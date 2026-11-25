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

export type Priority = 'Baixa' | 'Normal' | 'Alta' | 'Urgente';
export type SlaStatus = 'on_track' | 'due_soon' | 'overdue' | 'paused' | 'met' | 'breached';

export interface SlaState {
  status: SlaStatus;
  dueAt: string;
  targetMinutes: number;
  remainingMinutes: number;
  pausedMinutes: number;
  progress: number;
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
  priority: Priority;
  dueAt: string | null;
  originalDueAt: string | null;
  status: string;
  closeReason: string | null;
  closedAt: string | null;
  sla: SlaState;
  overdue: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  messageCount: number;
  attachmentCount: number;
}

export interface OccurrenceHistoryItem {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
  authorName: string | null;
}

export interface OccurrenceMessage {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  authorName: string | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  authorName: string | null;
  url: string;
}

export interface SlaPause {
  id: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  pausedMinutes: number;
  authorName: string | null;
}

export interface Category {
  id: string;
  name: string;
  slaHours: number;
  active: boolean;
  createdAt: string;
}

export interface DriverDocument {
  linkId: string;
  id: string;
  type: string;
  name: string;
  mime: string;
  size: number;
  expiryDate: string | null;
  expiryAlert: 'expired' | 'soon' | 'ok' | 'none';
  status: 'pendente' | 'aprovado' | 'rejeitado';
  notes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  url: string;
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
  photoUrl: string | null;
  notes: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  documentCount: number;
  pendingDocuments: number;
  expiringDocuments: number;
  documents?: DriverDocument[];
  history?: OccurrenceHistoryItem[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface WhatsappStatus {
  provider: string;
  configured: boolean;
  status: string;
  displayNumber: string | null;
  lastSyncAt: string | null;
  notes: string | null;
  missing: string[];
  capabilities: string[];
  webhookUrl: string;
  groupSupport: 'unknown' | 'yes' | 'no';
  canReadGroups: boolean;
  officialOnly: boolean;
  credentialsPresent: boolean;
  verified: boolean;
}

export interface WhatsappMessage {
  id: string;
  waMessageId: string | null;
  direction: 'inbound' | 'outbound';
  fromNumber: string | null;
  toNumber: string | null;
  contactName: string | null;
  body: string | null;
  occurredAt: string;
  occurrenceId: string | null;
  driverId: string | null;
  processed: boolean;
  processingStatus: string;
  mediaFileId: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  suggestionCount: number;
  occurrenceNumber: number | null;
  occurrenceStatus: string | null;
}

export interface WhatsappConversation {
  phone: string;
  lastAt: string;
  lastBody: string | null;
  pendingCount: number;
  pendingSuggestions: number;
  driverName: string | null;
}

export interface RegistrationFlow {
  id: string;
  phone: string;
  step: string;
  status: string;
  driverId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiSuggestion {
  id: string;
  messageId: string | null;
  occurrenceId: string | null;
  isComplaint: boolean;
  category: string | null;
  customerName: string | null;
  customerPhone: string | null;
  orderCode: string | null;
  trackingCode: string | null;
  driverName: string | null;
  occurrenceType: string | null;
  description: string | null;
  mentionedDate: string | null;
  additionalInfo: string | null;
  priority: Priority;
  missingFields: string[];
  confidence: number;
  status: string;
  source: string;
  createdOccurrenceId: string | null;
  reviewNotes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  messageBody: string | null;
  messageFrom: string | null;
}

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
  capabilities: string[];
  sourceLabel: string;
}

export interface DelaysResponse {
  alerts: Array<{
    id: string;
    number: number;
    customerName: string;
    category: string | null;
    priority: Priority;
    status: string;
    dueAt: string;
    remainingMinutes: number;
    progress: number;
    slaStatus: SlaStatus;
    description: string;
  }>;
  summary: string | null;
  source: string;
}

export const OCCURRENCE_STATUSES = [
  'Nova',
  'Em análise',
  'Em andamento',
  'Aguardando cliente',
  'Aguardando transportadora',
  'Aguardando motorista',
  'Resolvida',
  'Encerrada'
] as const;

export const PRIORITIES: Priority[] = ['Baixa', 'Normal', 'Alta', 'Urgente'];

export const DRIVER_STATUSES = [
  'Novo cadastro',
  'Aguardando documentos',
  'Documentação incompleta',
  'Em análise',
  'Aprovado',
  'Reprovado',
  'Inativo'
] as const;

export const DOCUMENT_STATUSES = ['pendente', 'aprovado', 'rejeitado'] as const;
