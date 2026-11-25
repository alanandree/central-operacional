import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { config } from './config.ts';
import { now, one } from './db.ts';

export type Role = 'admin' | 'employee';

export interface AuthUser {
  id: string;
  company_id: string;
  name: string;
  email: string;
  role: Role;
  avatar_url: string | null;
  theme: string;
}

export interface AuthedRequest extends Request {
  auth: AuthUser;
  rawBody?: Buffer;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
}

export function auth(req: Request): AuthUser {
  return (req as AuthedRequest).auth;
}

export function companyId(req: Request): string {
  return auth(req).company_id;
}

export const authRequired: RequestHandler = (req, res, next) => {
  try {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) fail(401, 'Não autenticado.');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    } catch {
      fail(401, 'Sessão inválida ou expirada.');
    }
    const user = one<AuthUser>(
      `SELECT u.id, u.company_id, u.name, u.email, u.role, u.avatar_url, u.theme
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.id = ?`,
      hashToken(token),
      now(),
      payload.sub
    );
    if (!user) fail(401, 'Sessão revogada.');
    (req as AuthedRequest).auth = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const adminRequired: RequestHandler = (req, res, next) => {
  try {
    if (auth(req).role !== 'admin') fail(403, 'Acesso restrito a administradores.');
    next();
  } catch (error) {
    next(error);
  }
};

export function pagination(req: Request): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
    const integrationError = error as { status: number; message: string };
    res.status(integrationError.status).json({ error: integrationError.message });
    return;
  }
  if (error && typeof error === 'object' && 'issues' in error) {
    res.status(400).json({ error: 'Dados inválidos.', issues: (error as { issues: unknown }).issues });
    return;
  }
  const message = error instanceof Error ? error.message : 'Erro interno.';
  console.error('[erro]', message);
  res.status(500).json({ error: 'Erro interno. Verifique os logs do servidor.' });
}
