import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';
import { HttpError } from './core.ts';
import { newId, now, run } from './db.ts';

const allowedExtensions = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.csv', '.txt', '.zip', '.mp3', '.ogg', '.mp4', '.3gp'
]);

const allowedMimes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv', 'application/zip',
  'audio/mpeg', 'audio/ogg', 'audio/mp4', 'video/mp4', 'video/3gpp',
  'application/octet-stream'
]);

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedMimes.has(file.mimetype) || !allowedExtensions.has(extension)) {
      callback(new HttpError(400, 'Tipo de arquivo não permitido.'));
      return;
    }
    callback(null, true);
  }
});

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  stored_name: string;
}

function detectMime(buffer: Buffer, declaredMime: string, extension: string): string {
  if (buffer.length < 4) throw new HttpError(400, 'Arquivo inválido ou vazio.');
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/zip';
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    return extension === '.xls' ? 'application/vnd.ms-excel' : 'application/msword';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return extension === '.3gp' ? 'video/3gpp' : 'video/mp4';
  if (!buffer.includes(0)) return extension === '.csv' ? 'text/csv' : 'text/plain';
  if (declaredMime === 'application/octet-stream') throw new HttpError(400, 'Não foi possível identificar o tipo real do arquivo.');
  return declaredMime;
}

function persistBuffer(companyId: string, userId: string, input: { buffer: Buffer; originalName: string; mime: string }): UploadedFile {
  const originalName = path.basename(input.originalName).slice(0, 200) || 'arquivo';
  const extension = path.extname(originalName).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new HttpError(400, 'Extensão de arquivo não permitida.');
  if (input.buffer.length > 15 * 1024 * 1024) throw new HttpError(413, 'Arquivo maior que 15 MB.');
  const mime = detectMime(input.buffer, input.mime, extension);
  const record: UploadedFile = {
    id: newId(),
    name: originalName,
    mime,
    size: input.buffer.length,
    stored_name: `${randomUUID()}${extension}`
  };
  fs.writeFileSync(path.join(config.uploadDir, record.stored_name), input.buffer, { mode: 0o600 });
  run(
    'INSERT INTO files (id, company_id, name, stored_name, mime, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    record.id, companyId, record.name, record.stored_name, record.mime, record.size, userId, now()
  );
  return record;
}

export function saveFile(companyId: string, userId: string, file: Express.Multer.File): UploadedFile {
  if (!file.buffer) throw new HttpError(400, 'Arquivo não disponível para processamento.');
  return persistBuffer(companyId, userId, { buffer: file.buffer, originalName: file.originalname, mime: file.mimetype });
}

export function saveBufferFile(
  companyId: string,
  userId: string,
  input: { buffer: Buffer; filename: string; mime: string }
): UploadedFile {
  return persistBuffer(companyId, userId, { buffer: input.buffer, originalName: input.filename, mime: input.mime });
}
