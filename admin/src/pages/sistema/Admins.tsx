import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/useFetch';
import { api, ApiError } from '../../lib/api';
import { Estado } from '../../components/Estado';
import { SistemaTabs } from '../../components/SistemaTabs';
import { dataHora } from '../../lib/format';

interface AdminRow {
  id: string;
  email: string;
  nome: string | null;
  ativo: boolean;
  ultimo_login_em: string | null;
  criado_em: string;
  roles: string[];
}

interface Papel {
  chave: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
}

export function Admins() {
  const { admin: eu } = useAuth();
  const { dados, carregando, erro, recarregar } = useFetch<{ admins: AdminRow[] }>(
    '/sistema/admins',
  );
  const { dados: papeisData } = useFetch<{ roles: Papel[] }>('/sistema/papeis');
  const papeis = papeisData?.roles ?? [];

  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState<AdminRow | null>(null);
  const [nova, setNova] = useState({ email: '', senha: '', nome: '', roles: [] as string[] });

  function toggleRole(lista: string[], chave: string): string[] {
    return lista.includes(chave) ? lista.filter((r) => r !== chave) : [...lista, chave];
  }

  async function criar() {
    setOcupado(true);
    setMsg('');
    try {
      await api('/sistema/admins', {
        method: 'POST',
        body: JSON.stringify({ ...nova, email: nova.email.trim(), nome: nova.nome.trim() || null }),
      });
      setNova({ email: '', senha: '', nome: '', roles: [] });
      recarregar();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Falhou.');
    } finally {
      setOcupado(false);
    }
  }

  async function salvarEdicao() {
    if (!editando) return;
    setOcupado(true);
    setMsg('');
    try {
      await api(`/sistema/admins/${editando.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ativo: editando.ativo, roles: editando.roles }),
      });
      setEditando(null);
      recarregar();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Falhou.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Sistema</h1>
      </header>
      <SistemaTabs />

      {msg && <p className="login-erro">{msg}</p>}

      <section className="painel">
        <h2>Novo admin</h2>
        <div className="form-grid">
          <label>
            E-mail
            <input value={nova.email} onChange={(e) => setNova({ ...nova, email: e.target.value })} />
          </label>
          <label>
            Nome
            <input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} />
          </label>
          <label>
            Senha (mín. 10)
            <input
              type="password"
              value={nova.senha}
              onChange={(e) => setNova({ ...nova, senha: e.target.value })}
            />
          </label>
        </div>
        <div className="bloco">
          <span className="campo-rotulo muted">Papéis</span>
          <div className="chips">
            {papeis.map((p) => (
              <label key={p.chave} className="chip-check" title={p.descricao ?? ''}>
                <input
                  type="checkbox"
                  checked={nova.roles.includes(p.chave)}
                  onChange={() => setNova({ ...nova, roles: toggleRole(nova.roles, p.chave) })}
                />
                {p.nome}
              </label>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="btn-primario"
          style={{ marginTop: 12 }}
          disabled={ocupado || !nova.email.trim() || nova.senha.length < 10}
          onClick={criar}
        >
          Criar admin
        </button>
      </section>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Nome</th>
                  <th>Papéis</th>
                  <th>Ativo</th>
                  <th>Último login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {dados.admins.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.email}
                      {a.id === eu?.adminId && <span className="muted bloco-menor">você</span>}
                    </td>
                    <td>{a.nome || '—'}</td>
                    <td>
                      {a.roles.length === 0 ? (
                        <span className="muted">sem papel</span>
                      ) : (
                        <div className="chips">
                          {a.roles.map((r) => (
                            <span key={r} className="chip chip-on">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${a.ativo ? 'ok' : 'muted'}`}>
                        {a.ativo ? 'ativo' : 'inativo'}
                      </span>
                    </td>
                    <td>{a.ultimo_login_em ? dataHora(a.ultimo_login_em) : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => setEditando({ ...a, roles: [...a.roles] })}
                      >
                        editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Estado>

      {editando && (
        <div className="modal-overlay" onClick={() => setEditando(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{editando.email}</h2>
            <div className="modal-corpo">
              <label className="toggle-linha">
                <input
                  type="checkbox"
                  checked={editando.ativo}
                  disabled={editando.id === eu?.adminId}
                  onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })}
                />
                Ativo{editando.id === eu?.adminId ? ' (não dá pra desativar a si mesmo)' : ''}
              </label>
              <div className="bloco">
                <span className="campo-rotulo muted">Papéis</span>
                <div className="chips">
                  {papeis.map((p) => (
                    <label key={p.chave} className="chip-check" title={p.descricao ?? ''}>
                      <input
                        type="checkbox"
                        checked={editando.roles.includes(p.chave)}
                        onChange={() =>
                          setEditando({ ...editando, roles: toggleRole(editando.roles, p.chave) })
                        }
                      />
                      {p.nome}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-acoes">
              <button type="button" className="btn-plano" onClick={() => setEditando(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primario"
                disabled={ocupado}
                onClick={salvarEdicao}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
