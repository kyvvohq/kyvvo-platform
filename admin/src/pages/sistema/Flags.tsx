import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/useFetch';
import { api, ApiError } from '../../lib/api';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { SistemaTabs } from '../../components/SistemaTabs';
import { dataHora } from '../../lib/format';

interface Flag {
  chave: string;
  escopo: string;
  alvo: string;
  valor: boolean;
  atualizado_em: string;
  atualizado_por_nome: string | null;
}

const ESCOPOS = ['global', 'produto', 'tenant'];

export function Flags() {
  const { pode } = useAuth();
  const editar = pode('flag:write');
  const { dados, carregando, erro, recarregar } = useFetch<{ flags: Flag[] }>('/sistema/flags');
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [nova, setNova] = useState({ chave: '', escopo: 'global', alvo: '', valor: true });

  async function salvar(payload: {
    chave: string;
    escopo: string;
    alvo: string;
    valor: boolean;
  }) {
    setOcupado(`${payload.chave}:${payload.escopo}:${payload.alvo}`);
    setMsg('');
    try {
      await api('/sistema/flags', { method: 'PUT', body: JSON.stringify(payload) });
      recarregar();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Falhou.');
    } finally {
      setOcupado('');
    }
  }

  async function remover(f: Flag) {
    setOcupado(`${f.chave}:${f.escopo}:${f.alvo}`);
    setMsg('');
    try {
      await api(
        `/sistema/flags/${encodeURIComponent(f.chave)}/${f.escopo}/${encodeURIComponent(f.alvo)}`,
        { method: 'DELETE' },
      );
      recarregar();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Falhou.');
    } finally {
      setOcupado('');
    }
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Sistema</h1>
      </header>
      <SistemaTabs />

      {msg && <p className="login-erro">{msg}</p>}

      {editar && (
        <section className="painel">
          <h2>Nova flag</h2>
          <div className="form-grid">
            <label>
              Chave
              <input
                value={nova.chave}
                placeholder="novo_onboarding"
                onChange={(e) => setNova({ ...nova, chave: e.target.value })}
              />
            </label>
            <label>
              Escopo
              <select
                value={nova.escopo}
                onChange={(e) => setNova({ ...nova, escopo: e.target.value })}
              >
                {ESCOPOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {nova.escopo !== 'global' && (
              <label>
                Alvo ({nova.escopo === 'produto' ? 'produto' : 'tenant id'})
                <input
                  value={nova.alvo}
                  onChange={(e) => setNova({ ...nova, alvo: e.target.value })}
                />
              </label>
            )}
            <label>
              Valor
              <select
                value={nova.valor ? '1' : '0'}
                onChange={(e) => setNova({ ...nova, valor: e.target.value === '1' })}
              >
                <option value="1">ligada</option>
                <option value="0">desligada</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="btn-primario"
            style={{ marginTop: 12 }}
            disabled={!nova.chave.trim() || !!ocupado}
            onClick={() =>
              salvar({
                chave: nova.chave.trim(),
                escopo: nova.escopo,
                alvo: nova.escopo === 'global' ? '*' : nova.alvo.trim(),
                valor: nova.valor,
              }).then(() => setNova({ chave: '', escopo: 'global', alvo: '', valor: true }))
            }
          >
            Criar
          </button>
        </section>
      )}

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.flags.length === 0 ? (
          <EmptyState titulo="Nenhuma feature flag" />
        ) : (
          dados && (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Chave</th>
                    <th>Escopo</th>
                    <th>Alvo</th>
                    <th>Valor</th>
                    <th>Atualizado</th>
                    {editar && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {dados.flags.map((f) => {
                    const id = `${f.chave}:${f.escopo}:${f.alvo}`;
                    return (
                      <tr key={id}>
                        <td>
                          <code>{f.chave}</code>
                        </td>
                        <td>{f.escopo}</td>
                        <td>{f.alvo}</td>
                        <td>
                          <span className={`badge badge-${f.valor ? 'ok' : 'muted'}`}>
                            {f.valor ? 'ligada' : 'desligada'}
                          </span>
                        </td>
                        <td className="muted">
                          {dataHora(f.atualizado_em)}
                          {f.atualizado_por_nome && (
                            <span className="bloco-menor">{f.atualizado_por_nome}</span>
                          )}
                        </td>
                        {editar && (
                          <td>
                            <div className="acoes-linha">
                              <button
                                type="button"
                                className="btn-mini"
                                disabled={ocupado === id}
                                onClick={() =>
                                  salvar({
                                    chave: f.chave,
                                    escopo: f.escopo,
                                    alvo: f.alvo,
                                    valor: !f.valor,
                                  })
                                }
                              >
                                {f.valor ? 'desligar' : 'ligar'}
                              </button>
                              <button
                                type="button"
                                className="btn-mini"
                                disabled={ocupado === id}
                                onClick={() => remover(f)}
                              >
                                remover
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </Estado>
    </div>
  );
}
