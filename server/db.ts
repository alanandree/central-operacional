import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
    avatar_url TEXT,
    theme TEXT NOT NULL DEFAULT 'dark',
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    UNIQUE (company_id, email)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS occurrence_categories (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sla_hours INTEGER NOT NULL DEFAULT 48,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (company_id, name)
  );

  CREATE TABLE IF NOT EXISTS occurrences (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    order_code TEXT,
    tracking_code TEXT,
    recipient_name TEXT,
    category_id TEXT REFERENCES occurrence_categories(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    received_at TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'Manual',
    responsible TEXT,
    priority TEXT NOT NULL CHECK (priority IN ('Baixa', 'Normal', 'Alta', 'Urgente')),
    due_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('Nova', 'Em análise', 'Em andamento', 'Aguardando cliente', 'Aguardando transportadora', 'Aguardando motorista', 'Resolvida', 'Encerrada')),
    close_reason TEXT,
    sla_paused_at TEXT,
    sla_pause_minutes INTEGER NOT NULL DEFAULT 0,
    sla_target_minutes INTEGER,
    closed_at TEXT,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (company_id, number)
  );

  CREATE TABLE IF NOT EXISTS occurrence_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS occurrence_attachments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sla_pauses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
    paused_at TEXT NOT NULL,
    resumed_at TEXT,
    pause_minutes INTEGER,
    reason TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cpf TEXT NOT NULL,
    birth_date TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    cnh_number TEXT,
    cnh_category TEXT,
    cnh_expiry TEXT,
    photo_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('Novo cadastro', 'Aguardando documentos', 'Documentação incompleta', 'Em análise', 'Aprovado', 'Reprovado', 'Inativo')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (company_id, cpf)
  );

  CREATE TABLE IF NOT EXISTS driver_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS driver_documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    expiry_date TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    notes TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS driver_registration_flows (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    step TEXT NOT NULL DEFAULT 'name',
    data TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pendente',
    driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (company_id, phone, status)
  );

  CREATE TABLE IF NOT EXISTS whatsapp_integrations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'cloud_api',
    status TEXT NOT NULL DEFAULT 'not_configured',
    display_number TEXT,
    last_sync_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (company_id, provider)
  );

  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    wa_message_id TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    from_number TEXT,
    to_number TEXT,
    contact_name TEXT,
    body TEXT,
    media_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
    media_mime TEXT,
    media_name TEXT,
    occurred_at TEXT NOT NULL,
    occurrence_id TEXT REFERENCES occurrences(id) ON DELETE SET NULL,
    driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
    processed INTEGER NOT NULL DEFAULT 0,
    processing_status TEXT NOT NULL DEFAULT 'pendente',
    raw TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (company_id, wa_message_id)
  );

  CREATE TABLE IF NOT EXISTS ai_suggestions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
    occurrence_id TEXT REFERENCES occurrences(id) ON DELETE SET NULL,
    is_complaint INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    order_code TEXT,
    tracking_code TEXT,
    driver_name TEXT,
    occurrence_type TEXT,
    description TEXT,
    mentioned_date TEXT,
    additional_info TEXT,
    priority TEXT,
    missing_fields TEXT NOT NULL DEFAULT '[]',
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'pendente',
    review_notes TEXT,
    reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT,
    created_occurrence_id TEXT REFERENCES occurrences(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS privacy_requests (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('exportacao', 'exclusao')),
    status TEXT NOT NULL DEFAULT 'pendente',
    subject_name TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (company_id, key)
  );

  CREATE INDEX IF NOT EXISTS idx_occurrences_company_status ON occurrences(company_id, status);
  CREATE INDEX IF NOT EXISTS idx_occurrences_company_due ON occurrences(company_id, due_at);
  CREATE INDEX IF NOT EXISTS idx_occurrences_company_created ON occurrences(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_occurrences_number ON occurrences(company_id, number);
  CREATE INDEX IF NOT EXISTS idx_drivers_company_status ON drivers(company_id, status);
  CREATE INDEX IF NOT EXISTS idx_drivers_expiry ON drivers(company_id, cnh_expiry);
  CREATE INDEX IF NOT EXISTS idx_messages_company_date ON whatsapp_messages(company_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_company_from ON whatsapp_messages(company_id, from_number, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_occurrence ON whatsapp_messages(company_id, occurrence_id);
  CREATE INDEX IF NOT EXISTS idx_suggestions_status ON ai_suggestions(company_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_company ON activity_logs(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_files_company ON files(company_id, created_at DESC);
`);

export function newId(): string {
  return randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function all<T = any>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params).map((row) => ({ ...(row as object) })) as T[];
}

export function one<T = any>(sql: string, ...params: any[]): T | undefined {
  const row = db.prepare(sql).get(...params);
  return row ? ({ ...(row as object) } as T) : undefined;
}

export function run(sql: string, ...params: any[]): void {
  db.prepare(sql).run(...params);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function getSetting<T>(companyId: string, key: string, fallback: T): T {
  const row = one<{ value: string | null }>('SELECT value FROM settings WHERE company_id = ? AND key = ?', companyId, key);
  return row ? parseJson(row.value, fallback) : fallback;
}

export function setSetting(companyId: string, key: string, value: unknown): void {
  run(
    'INSERT INTO settings (company_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    companyId,
    key,
    stringify(value),
    now()
  );
}

const sensitiveKeys = new Set([
  'password', 'currentpassword', 'newpassword', 'passwordhash', 'token', 'accesstoken',
  'refreshtoken', 'apikey', 'secret', 'appsecret', 'jwtsecret', 'cpf', 'cnh',
  'cnhnumber', 'raw', 'body', 'description', 'notes', 'address', 'phone', 'email'
]);

function redact(value: unknown, key = ''): unknown {
  if (sensitiveKeys.has(key.toLowerCase())) return '[redigido]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

export function logActivity(companyId: string, userId: string, action: string, entity: string, entityId?: string, metadata?: unknown): void {
  run(
    'INSERT INTO activity_logs (id, company_id, user_id, action, entity, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    companyId,
    userId,
    action,
    entity,
    entityId ?? null,
    stringify(redact(metadata ?? null)),
    now()
  );
}

export function notify(companyId: string, userId: string, type: string, title: string, body?: string): void {
  run(
    'INSERT INTO notifications (id, company_id, user_id, type, title, body, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
    newId(),
    companyId,
    userId,
    type,
    title,
    body ?? null,
    now()
  );
}

export function notifyAdmins(companyId: string, type: string, title: string, body?: string): void {
  for (const admin of all<{ id: string }>('SELECT id FROM users WHERE company_id = ? AND role = ?', companyId, 'admin')) {
    notify(companyId, admin.id, type, title, body);
  }
}

export function nextOccurrenceNumber(companyId: string): number {
  const row = one<{ n: number }>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM occurrences WHERE company_id = ?', companyId);
  return row?.n ?? 1;
}

export function addOccurrenceHistory(companyId: string, occurrenceId: string, userId: string, action: string, details?: string): void {
  run(
    'INSERT INTO occurrence_history (id, company_id, occurrence_id, action, details, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    companyId,
    occurrenceId,
    action,
    details ?? null,
    userId,
    now()
  );
}

export function addDriverHistory(companyId: string, driverId: string, userId: string, action: string, details?: string): void {
  run(
    'INSERT INTO driver_history (id, company_id, driver_id, action, details, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    companyId,
    driverId,
    action,
    details ?? null,
    userId,
    now()
  );
}

function columnExists(table: string, column: string): boolean {
  return all<{ name: string }>(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

function migrate(): void {
  const current = one<{ version: number }>('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')?.version ?? 0;

  if (current < 1) {
    db.exec(`
      UPDATE activity_logs SET metadata = '"[redigido]"'
      WHERE metadata IS NOT NULL AND (
        metadata LIKE '%password%' OR metadata LIKE '%token%' OR metadata LIKE '%cpf%' OR metadata LIKE '%cnh%'
      );
    `);
    run('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL', now());
    run('DELETE FROM password_resets WHERE expires_at <= ? OR used_at IS NOT NULL', now());
    run('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)', now());
  }

  if (current < 2) {
    const needsOccurrenceRebuild = !columnExists('occurrences', 'close_reason');
    if (needsOccurrenceRebuild) {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`
        BEGIN;
        CREATE TABLE occurrences_v2 (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          number INTEGER NOT NULL,
          customer_name TEXT NOT NULL,
          customer_phone TEXT,
          order_code TEXT,
          tracking_code TEXT,
          recipient_name TEXT,
          category_id TEXT REFERENCES occurrence_categories(id) ON DELETE SET NULL,
          description TEXT NOT NULL,
          received_at TEXT NOT NULL,
          origin TEXT NOT NULL DEFAULT 'Manual',
          responsible TEXT,
          priority TEXT NOT NULL CHECK (priority IN ('Baixa', 'Normal', 'Alta', 'Urgente')),
          due_at TEXT,
          status TEXT NOT NULL CHECK (status IN ('Nova', 'Em análise', 'Em andamento', 'Aguardando cliente', 'Aguardando transportadora', 'Aguardando motorista', 'Resolvida', 'Encerrada')),
          close_reason TEXT,
          sla_paused_at TEXT,
          sla_pause_minutes INTEGER NOT NULL DEFAULT 0,
          sla_target_minutes INTEGER,
          closed_at TEXT,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (company_id, number)
        );
        INSERT INTO occurrences_v2 (
          id, company_id, number, customer_name, customer_phone, order_code, tracking_code, recipient_name,
          category_id, description, received_at, origin, responsible, priority, due_at, status, closed_at,
          created_by, created_at, updated_at
        )
        SELECT
          id, company_id, number, customer_name, customer_phone, order_code, tracking_code, recipient_name,
          category_id, description, received_at, origin, responsible, priority, due_at,
          CASE
            WHEN status = 'Nova ocorrência' THEN 'Nova'
            WHEN status = 'Aguardando retorno' THEN 'Aguardando cliente'
            ELSE status
          END,
          closed_at, created_by, created_at, updated_at
        FROM occurrences;
        DROP TABLE occurrences;
        ALTER TABLE occurrences_v2 RENAME TO occurrences;
        CREATE INDEX IF NOT EXISTS idx_occurrences_company_status ON occurrences(company_id, status);
        CREATE INDEX IF NOT EXISTS idx_occurrences_company_due ON occurrences(company_id, due_at);
        CREATE INDEX IF NOT EXISTS idx_occurrences_company_created ON occurrences(company_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_occurrences_number ON occurrences(company_id, number);
        COMMIT;
      `);
      db.exec('PRAGMA foreign_keys = ON');
    }

    if (!columnExists('drivers', 'photo_file_id')) db.exec('ALTER TABLE drivers ADD COLUMN photo_file_id TEXT REFERENCES files(id) ON DELETE SET NULL');
    if (!columnExists('whatsapp_messages', 'contact_name')) db.exec('ALTER TABLE whatsapp_messages ADD COLUMN contact_name TEXT');
    if (!columnExists('whatsapp_messages', 'media_mime')) db.exec('ALTER TABLE whatsapp_messages ADD COLUMN media_mime TEXT');
    if (!columnExists('whatsapp_messages', 'media_name')) db.exec('ALTER TABLE whatsapp_messages ADD COLUMN media_name TEXT');
    if (!columnExists('whatsapp_messages', 'processing_status')) db.exec("ALTER TABLE whatsapp_messages ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'pendente'");
    run("UPDATE whatsapp_messages SET processing_status = CASE WHEN processed = 1 THEN 'processado' ELSE 'pendente' END WHERE processing_status = 'pendente'");
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_company_processed ON whatsapp_messages(company_id, processing_status, occurred_at DESC)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS sla_pauses (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
        paused_at TEXT NOT NULL,
        resumed_at TEXT,
        pause_minutes INTEGER,
        reason TEXT,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS driver_documents_v2 (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        expiry_date TEXT,
        status TEXT NOT NULL DEFAULT 'pendente',
        notes TEXT,
        reviewed_at TEXT,
        reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS driver_registration_flows (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        phone TEXT NOT NULL,
        step TEXT NOT NULL DEFAULT 'name',
        data TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pendente',
        driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (company_id, phone, status)
      );
      CREATE TABLE IF NOT EXISTS ai_suggestions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
        occurrence_id TEXT REFERENCES occurrences(id) ON DELETE SET NULL,
        is_complaint INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        order_code TEXT,
        tracking_code TEXT,
        driver_name TEXT,
        occurrence_type TEXT,
        description TEXT,
        mentioned_date TEXT,
        additional_info TEXT,
        priority TEXT,
        missing_fields TEXT NOT NULL DEFAULT '[]',
        confidence REAL,
        status TEXT NOT NULL DEFAULT 'pendente',
        review_notes TEXT,
        reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TEXT,
        created_occurrence_id TEXT REFERENCES occurrences(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS privacy_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('exportacao', 'exclusao')),
        status TEXT NOT NULL DEFAULT 'pendente',
        subject_name TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);

    const docColumns = columnExists('driver_documents', 'expiry_date');
    if (!docColumns) {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`
        BEGIN;
        INSERT INTO driver_documents_v2 (id, company_id, driver_id, file_id, type, created_at)
        SELECT id, company_id, driver_id, file_id, type, created_at FROM driver_documents;
        DROP TABLE driver_documents;
        ALTER TABLE driver_documents_v2 RENAME TO driver_documents;

        COMMIT;
      `);
      db.exec('PRAGMA foreign_keys = ON');
    } else {
      db.exec('DROP TABLE IF EXISTS driver_documents_v2');
      db.exec('CREATE INDEX IF NOT EXISTS idx_driver_documents_expiry ON driver_documents(company_id, expiry_date)');
    }

    run('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)', now());
  }
}

export function initDb(): void {
  migrate();

  transaction(() => {
    const existing = one<{ id: string }>('SELECT id FROM companies LIMIT 1');
    const companyId = existing?.id ?? newId();
    if (!existing) run('INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)', companyId, 'Empresa', now());

    const adminEmail = config.adminEmail.trim().toLowerCase();
    const admin = one<{ id: string }>('SELECT id FROM users WHERE company_id = ? AND email = ?', companyId, adminEmail);
    if (!admin) {
      run(
        'INSERT INTO users (id, company_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId(), companyId, config.adminName, adminEmail, bcrypt.hashSync(config.adminPassword, 10), 'admin', now()
      );
    }

    const categoryCount = one<{ n: number }>('SELECT COUNT(*) AS n FROM occurrence_categories WHERE company_id = ?', companyId)?.n ?? 0;
    if (categoryCount === 0) {
      const defaults: Array<[string, number]> = [
        ['Produto não recebido', 24], ['Pedido extraviado', 24], ['Produto danificado', 48],
        ['Entrega incompleta', 24], ['Atraso na entrega', 12], ['Problema com entregador', 24],
        ['Endereço incorreto', 48], ['Problema de coleta', 24], ['Outros', 72]
      ];
      for (const [name, hours] of defaults) {
        run(
          'INSERT INTO occurrence_categories (id, company_id, name, sla_hours, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
          newId(), companyId, name, hours, now()
        );
      }
    }

    run(
      'INSERT OR IGNORE INTO whatsapp_integrations (id, company_id, provider, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(), companyId, 'cloud_api', 'not_configured', now(), now()
    );

    const defaults: Record<string, unknown> = {
      sla_default_hours: 48,
      business_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
      holidays: [],
      sla_priority_factor: { Baixa: 1.5, Normal: 1, Alta: 0.5, Urgente: 0.25 },
      sla_pause_statuses: ['Aguardando cliente', 'Aguardando transportadora', 'Aguardando motorista'],
      notification_offsets: [24, 12, 2, 0],
      whatsapp_group_support: 'unknown',
      document_alert_days: 30,
      retention_days: 365,
      required_driver_documents: ['CNH', 'Comprovante de residência']
    };
    for (const [key, value] of Object.entries(defaults)) {
      run(
        'INSERT OR IGNORE INTO settings (company_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
        companyId, key, stringify(value), now()
      );
    }
  });
}

initDb();
