import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/useFetch';
import { api, ApiError } from '../../lib/api';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { WhatsappTabs } from '../../components/WhatsappTabs';
import { dataHora } from '../../lib/format';

interface NumeroPronto {
  id: string;
  telefone: string;
  meta_phone_number_id: string;
  meta_waba_id: string;
  status: string;
  tenant_id: string | null;
  tenant_nome: string | null;
  vinculado_em: string | null;
  testado_em: string | null;
  teste_resultado: string | null;
  criado_em: string;
}

const TOM: Record<string, string> = {
  disponivel: 'info',
  reservado: 'warn',
  em_configuracao: 'warn',
  ativo: 'ok',
  erro: 'danger',
};

export function NumerosProntos() {
  const { pode } = useAuth();
  const editar = pode('whatsapp:disable');
  const { dados, carregando, erro, recarregar } = useFetch<{ numeros: NumeroPronto[] }>(
    '/whatsapp/numeros-prontos',
  );
  const { dados: empresas } = useFetch<{ clientes: { id: string; nome: string }[] }>(
    editar ? '/clientes?limit=100' : null,
  );

  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [novo, setNovo] = useState({ telefone: '', meta_phone_number_id: '', meta_waba_id: '' });
  const [vinc, setVinc] = useState<Record<string, string>>({});
  const [teste, setTeste] = useState<Record<string, string>>({});

  async function acao(chave: string, fn: () => Promise<unknown>) {
    setOcupado(chave);
    setMsg('');
    try {
      await fn();
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
        <h1>WhatsApp</h1>
      </header>
      <WhatsappTabs />

      {msg && <p className="login-erro">{msg}</p>}

      {editar && (
        <section className="painel">
          <h2>Cadastrar número</h2>
          <div className="form-grid">
            <label>
              Telefone
              <input
                value={novo.telefone}
                onChange={(e) => setNovo({ ...novo, telefone: e.target.value })}
              />
            </label>
            <label>
              Phone Number ID
              <input
                value={novo.meta_phone_number_id}
                onChange={(e) => setNovo({ ...novo, meta_phone_number_id: e.target.value })}
              />
            </label>
            <label>
              WABA ID
              <input
                value={novo.meta_waba_id}
                onChange={(e) => setNovo({ ...novo, meta_waba_id: e.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn-primario"
            style={{ marginTop: 12 }}
            disabled={
              !!ocupado ||
              !novo.telefone.trim() ||
              !novo.meta_phone_number_id.trim() ||
              !novo.meta_waba_id.trim()
            }
            onClick={() =>
              acao('novo', () =>
                api('/whatsapp/numeros-prontos', {
                  method: 'POST',
                  body: JSON.stringify({
                    telefone: novo.telefone.trim(),
                    meta_phone_number_id: novo.meta_phone_number_id.trim(),
                    meta_waba_id: novo.meta_waba_id.trim(),
                  }),
                }).then(() => setNovo({ telefone: '', meta_phone_number_id: '', meta_waba_id: '' })),
              )
            }
          >
            Cadastrar
          </button>
        </section>
      )}

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.numeros.length === 0 ? (
          <EmptyState titulo="Nenhum número no inventário" />
        ) : (
          dados && (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Telefone</th>
                    <th>Phone Number ID</th>
                    <th>Status</th>
                    <th>Salão</th>
                    <th>Último evento</th>
                    {editar && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {dados.numeros.map((n) => (
                    <tr key={n.id}>
                      <td>{n.telefone}</td>
                      <td>
                        <code>{n.meta_phone_number_id}</code>
                      </td>
                      <td>
                        <span className={`badge badge-${TOM[n.status] ?? 'muted'}`}>{n.status}</span>
                      </td>
                      <td>{n.tenant_nome || '—'}</td>
                      <td className="muted">
                        {n.testado_em
                          ? `testado ${dataHora(n.testado_em)}`
                          : n.vinculado_em
                            ? `vinculado ${dataHora(n.vinculado_em)}`
                            : `criado ${dataHora(n.criado_em)}`}
                        {n.teste_resultado && (
                          <span className="bloco-menor">{n.teste_resultado}</span>
                        )}
                      </td>
                      {editar && (
                        <td>
                          {n.status === 'disponivel' && (
                            <div className="acao-plano">
                              <select
                                value={vinc[n.id] ?? ''}
                                onChange={(e) => setVinc({ ...vinc, [n.id]: e.target.value })}
                              >
                                <option value="">Vincular a…</option>
                                {empresas?.clientes.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.nome}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn-mini"
                                disabled={!vinc[n.id] || ocupado === n.id}
                                onClick={() =>
                                  acao(n.id, () =>
                                    api(`/whatsapp/numeros-prontos/${n.id}/vincular`, {
                                      method: 'POST',
                                      body: JSON.stringify({ tenant_id: vinc[n.id] }),
                                    }),
                                  )
                                }
                              >
                                ok
                              </button>
                            </div>
                          )}
                          {n.tenant_id && (
                            <div className="acao-plano">
                              <input
                                placeholder="55DDDNNNNNNNN"
                                value={teste[n.id] ?? ''}
                                onChange={(e) => setTeste({ ...teste, [n.id]: e.target.value })}
                                style={{ maxWidth: 150 }}
                              />
                              <button
                                type="button"
                                className="btn-mini"
                                disabled={!teste[n.id] || ocupado === n.id}
                                onClick={() =>
                                  acao(n.id, () =>
                                    api(`/whatsapp/numeros-prontos/${n.id}/testar`, {
                                      method: 'POST',
                                      body: JSON.stringify({ numero_destino: teste[n.id] }),
                                    }),
                                  )
                                }
                              >
                                testar
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Estado>
    </div>
  );
}
