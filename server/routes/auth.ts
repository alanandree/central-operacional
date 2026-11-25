import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.ts';
import { all, logActivity, newId, now, one, run } from '../db.ts';
import { asyncRoute, auth, authRequired, companyId, fail, hashToken, signToken } from '../core.ts';
import { sendResetEmail } from '../integrations.ts';
import { saveFile, upload } from '../upload.ts';

export const authRoutes = Router();

function sessionExpiry(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function publicUser(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatar_url ?? null,
    theme: row.theme ?? 'dark',
    companyId: row.company_id,
    companyName: row.company_name ?? null,
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at
  };
}

authRoutes.post(
  '/login',
  asyncRoute(async (req, res) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const email = body.email.trim().toLowerCase();
    const user = one<any>('SELECT * FROM users WHERE email = ?', email);
    if (!user || !bcrypt.compareSync(body.password, user.password_hash)) fail(401, 'E-mail ou senha incorretos.');

    const token = signToken(user.id);
    run(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      user.id,
      hashToken(token),
      now(),
      sessionExpiry()
    );
    run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
    logActivity(user.company_id, user.id, 'login', 'auth', user.id, { email });
    const fresh = one<any>(
      `SELECT u.*, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?`,
      user.id
    );
    res.json({ token, user: publicUser(fresh) });
  })
);

authRoutes.get(
  '/me',
  authRequired,
  asyncRoute(async (req, res) => {
    const user = one<any>(
      `SELECT u.*, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?`,
      auth(req).id
    );
    if (!user) fail(401, 'Usuário não encontrado.');
    res.json({ user: publicUser(user) });
  })
);

authRoutes.post(
  '/logout',
  authRequired,
  asyncRoute(async (req, res) => {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', now(), hashToken(token));
    logActivity(companyId(req), auth(req).id, 'logout', 'auth', auth(req).id);
    res.json({ ok: true });
  })
);

authRoutes.post(
  '/forgot-password',
  asyncRoute(async (req, res) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const user = one<{ id: string; company_id: string; email: string }>(
      'SELECT id, company_id, email FROM users WHERE email = ?',
      body.email.trim().toLowerCase()
    );
    if (!user) {
      res.json({ message: 'Se o e-mail existir, um link de recuperação será enviado.', emailSent: false });
      return;
    }
    const token = randomBytes(32).toString('base64url');
    run(
      'INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      newId(),
      user.id,
      hashToken(token),
      new Date(Date.now() + 30 * 60 * 1000).toISOString()
    );
    logActivity(user.company_id, user.id, 'password_reset_requested', 'auth', user.id);
    const result = await sendResetEmail(user.email, token);
    const response: Record<string, unknown> = {
      message: result.sent ? 'Link de recuperação enviado.' : 'Provedor de e-mail não configurado.',
      emailSent: result.sent
    };
    if (!result.sent && !config.isProd) {
      response.devToken = token;
      response.warning = 'Token devolvido apenas em desenvolvimento; configure RESEND_API_KEY para produção.';
    }
    res.json(response);
  })
);

authRoutes.post(
  '/reset-password',
  asyncRoute(async (req, res) => {
    const body = z.object({ token: z.string().min(10), password: z.string().min(8) }).parse(req.body);
    const reset = one<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
      hashToken(body.token),
      now()
    );
    if (!reset) fail(400, 'Token inválido ou expirado.');
    run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(body.password, 10), reset.user_id);
    run('UPDATE password_resets SET used_at = ? WHERE id = ?', now(), reset.id);
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now(), reset.user_id);
    res.json({ ok: true, message: 'Senha redefinida. Faça login novamente.' });
  })
);

authRoutes.post(
  '/change-password',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
      .parse(req.body);
    const user = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', auth(req).id);
    if (!user || !bcrypt.compareSync(body.currentPassword, user.password_hash)) fail(400, 'Senha atual incorreta.');
    run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(body.newPassword, 10), auth(req).id);
    logActivity(companyId(req), auth(req).id, 'password_changed', 'auth', auth(req).id);
    res.json({ ok: true });
  })
);

authRoutes.patch(
  '/me',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2).optional(),
        email: z.string().email().optional(),
        theme: z.enum(['dark', 'light']).optional()
      })
      .parse(req.body);
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      fields.push(`${key === 'theme' ? 'theme' : key} = ?`);
      values.push(key === 'email' ? value.trim().toLowerCase() : value);
    }
    if (fields.length === 0) fail(400, 'Nenhum campo informado.');
    values.push(auth(req).id);
    try {
      run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...values);
    } catch {
      fail(409, 'Este e-mail já está em uso.');
    }
    logActivity(companyId(req), auth(req).id, 'profile_updated', 'auth', auth(req).id, body);
    const user = one<any>(
      `SELECT u.*, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?`,
      auth(req).id
    );
    res.json({ user: publicUser(user) });
  })
);

authRoutes.post(
  '/avatar',
  authRequired,
  upload.single('avatar'),
  asyncRoute(async (req, res) => {
    if (!req.file) fail(400, 'Nenhuma imagem enviada.');
    const file = saveFile(companyId(req), auth(req).id, req.file);
    const url = `/api/files/${file.id}/download`;
    run('UPDATE users SET avatar_url = ? WHERE id = ?', url, auth(req).id);
    res.json({ avatarUrl: url });
  })
);

authRoutes.get(
  '/sessions',
  authRequired,
  asyncRoute(async (req, res) => {
    const header = req.header('authorization') || '';
    const currentHash = hashToken(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
    const sessions = all<any>(
      `SELECT id, token_hash, created_at, expires_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC`,
      auth(req).id
    ).map((session) => {
      const { token_hash, ...rest } = session;
      return {
        ...rest,
        current: token_hash === currentHash && session.revoked_at === null
      };
    });
    res.json({ sessions });
  })
);

authRoutes.delete(
  '/sessions/:id',
  authRequired,
  asyncRoute(async (req, res) => {
    const session = one<{ id: string }>('SELECT id FROM sessions WHERE id = ? AND user_id = ?', req.params.id, auth(req).id);
    if (!session) fail(404, 'Sessão não encontrada.');
    run('UPDATE sessions SET revoked_at = ? WHERE id = ?', now(), session.id);
    res.json({ ok: true });
  })
);
