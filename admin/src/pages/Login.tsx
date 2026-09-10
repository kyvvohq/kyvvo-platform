import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

export function Login() {
  const { entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
      // AuthProvider recarrega o /me e o App troca pra rota autenticada.
    } catch {
      setErro('E-mail ou senha inválidos.');
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tela-cheia login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-marca">
          <span className="sidebar-logo">kyvvo</span>
          <span className="sidebar-tag">admin</span>
        </div>
        <label>
          E-mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
        </label>
        {erro && (
          <p className="login-erro" role="alert">
            {erro}
          </p>
        )}
        <button type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
