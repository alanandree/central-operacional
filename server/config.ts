import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

function jwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(dataDir, 'jwt-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const generated = randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  isProd: process.env.NODE_ENV === 'production',
  jwtSecret: jwtSecret(),
  adminName: process.env.ADMIN_NAME || 'Administradora',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@empresa.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  dbPath: path.join(dataDir, 'central.db'),
  appSecret: process.env.APP_SECRET || '',
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0'
  },
  ai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  },
  resendApiKey: process.env.RESEND_API_KEY || ''
};

fs.mkdirSync(config.uploadDir, { recursive: true });
