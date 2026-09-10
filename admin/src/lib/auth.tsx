import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, clearToken, getToken } from './api';

export interface Admin {
  adminId: string;
  email: string;
  nome: string | null;
  roles: string[];
  perms: string[];
}

interface AuthCtx {
  admin: Admin | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => void;
  /** true se o admin tem QUALQUER uma das permissões passadas. */
  pode: (...perms: string[]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregarMe() {
    if (!getToken()) {
      setAdmin(null);
      setCarregando(false);
      return;
    }
    try {
      setAdmin(await api<Admin>('/auth/me'));
    } catch {
      setAdmin(null);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregarMe();
  }, []);

  async function entrar(email: string, senha: string) {
    const { token } = await api<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    });
    setToken(token);
    setCarregando(true);
    await carregarMe();
  }

  function sair() {
    clearToken();
    setAdmin(null);
    window.location.assign('/admin/login');
  }

  const pode = (...perms: string[]) => !!admin && perms.some((p) => admin.perms.includes(p));

  return (
    <Ctx.Provider value={{ admin, carregando, entrar, sair, pode }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
