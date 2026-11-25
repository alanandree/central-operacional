import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';
import { newId, now, run } from './db.ts';

const allowedMimes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip'
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, config.uploadDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase().slice(0, 10);
    callback(null, `${randomUUID()}${extension}`);
  }
});

export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (allowedMimes.has(file.mimetype)) callback(null, true);
    else callback(new Error('Tipo de arquivo não permitido.'));
  }
});

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  stored_name: string;
}

export function saveFile(companyId: string, userId: string, file: Express.Multer.File): UploadedFile {
  const record: UploadedFile = {
    id: newId(),
    name: path.basename(file.originalname).slice(0, 200),
    mime: file.mimetype,
    size: file.size,
    stored_name: file.filename
  };
  run(
    'INSERT INTO files (id, company_id, name, stored_name, mime, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    record.id,
    companyId,
    record.name,
    record.stored_name,
    record.mime,
    record.size,
    userId,
    now()
  );
  return record;
}
