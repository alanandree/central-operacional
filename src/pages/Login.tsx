import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { Button, Field, Input } from '../components/ui';

export function LoginPage() {
  const { user, loading, login, toast } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setResetOpen(true);
      setResetToken(token);
    }
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      toast('Bem-vinda de volta!');
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  const requestReset = async () => {
    try {
      const data = await api<{ message: string; devToken?: string; emailSent: boolean }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: resetEmail })
      });
      toast(data.message, 'info');
      if (data.devToken) setResetToken(data.devToken);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao solicitar recuperação.', 'error');
    }
  };

  const doReset = async () => {
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, password: newPassword })
      });
      toast('Senha redefinida. Faça login.');
      setResetOpen(false);
      setResetToken('');
      setNewPassword('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao redefinir senha.', 'error');
    }
  };

  return (
    <div className="flex min-h-screen bg-canvas">
      <div className="hidden flex-1 flex-col justify-between border-r border-line bg-sidebar p-12 lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-info text-sm font-bold text-white">CO</div>
            <div>
              <p className="font-semibold text-ink">Central Operacional</p>
              <p className="text-xs text-muted">Gestão de operações e SAC</p>
            </div>
          </div>
          <h1 className="mt-20 max-w-lg text-4xl font-semibold leading-tight tracking-tight text-ink">
            Todas as ocorrências, motoristas e documentos em um só lugar.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted">
            Centralize o que hoje chega pelo WhatsApp, acompanhe prazos, organize cadastros e reduza tarefas manuais com segurança.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <ShieldCheck className="h-4 w-4 text-success" />
          Acesso autenticado e dados privados por empresa.
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info text-xs font-bold text-white">CO</div>
            <p className="font-semibold text-ink">Central Operacional</p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-7 shadow-soft">
            <h2 className="text-xl font-semibold text-ink">Entrar na plataforma</h2>
            <p className="mt-1 text-sm text-muted">Use as credenciais definidas no arquivo .env.</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field label="E-mail">
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input className="pl-9" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" />
                </div>
              </Field>
              <Field label="Senha">
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input className="pl-9" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
                </div>
              </Field>
              {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
              <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                {busy ? 'Entrando...' : 'Entrar'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <button onClick={() => setResetOpen((open) => !open)} className="mt-4 w-full text-center text-xs text-muted hover:text-info">
              Esqueci minha senha
            </button>

            {resetOpen && (
              <div className="mt-4 space-y-3 rounded-xl border border-line bg-canvas p-4">
                {!resetToken ? (
                  <>
                    <Field label="E-mail para recuperação">
                      <Input type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} />
                    </Field>
                    <Button className="w-full" onClick={() => void requestReset()}>Solicitar link</Button>
                  </>
                ) : (
                  <>
                    <Field label="Nova senha" hint="Mínimo de 8 caracteres">
                      <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                    </Field>
                    <Button variant="primary" className="w-full" onClick={() => void doReset()}>Redefinir senha</Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
