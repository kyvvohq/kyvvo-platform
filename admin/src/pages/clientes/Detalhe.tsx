import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';
import { StatusBadge } from '../../components/StatusBadge';
import { data, dataHora, telefone } from '../../lib/format';
import { Acoes } from './Acoes';
import { Entitlements } from './Entitlements';
import { BillingSecao } from './BillingSecao';
import type { Cliente360 } from './types';

function Campo({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="campo">
      <span className="campo-rotulo muted">{rotulo}</span>
      <span className="campo-valor">{valor ?? '—'}</span>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="painel">
      <h2>{titulo}</h2>
      {children}
    </section>
  );
}

export function Detalhe() {
  const { id } = useParams<{ id: string }>();
  const { dados: c, carregando, erro, recarregar } = useFetch<Cliente360>(id ? `/clientes/${id}` : null);

  return (
    <div className="pagina">
      <div className="voltar">
        <Link to="/clientes" className="muted">
          ← Empresas
        </Link>
      </div>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {c && (
          <>
            <header className="pagina-header linha-titulo">
              <div>
                <h1>{c.nome}</h1>
                <p className="muted">
                  {c.segmento || 'sem segmento'} · cadastro {data(c.criado_em)}
                  {c.ativado_em ? ` · ativada ${data(c.ativado_em)}` : ''}
                </p>
              </div>
              <StatusBadge status={c.status_conta} />
            </header>

            <Acoes cliente={c} onMudou={recarregar} />

            <div className="grade-360">
              <Secao titulo="Identidade">
                <div className="campos">
                  <Campo rotulo="Telefone" valor={telefone(c.telefone)} />
                  <Campo rotulo="WhatsApp" valor={c.whatsapp ? telefone(c.whatsapp) : '—'} />
                  <Campo
                    rotulo="Número conectado"
                    valor={c.whatsapp_conectado ? `sim · PNID ${c.meta_phone_number_id}` : 'não'}
                  />
                  <Campo rotulo="Endereço" valor={c.endereco} />
                  <Campo rotulo="CNPJ/CPF" valor={c.billing.cpf_cnpj} />
                </div>
              </Secao>

              <Secao titulo="Plano & entitlements">
                <div className="campos">
                  <Campo rotulo="Plano" valor={c.plano.nome} />
                  <Campo rotulo="Status" valor={c.status} />
                  {c.trial.ativo && (
                    <Campo
                      rotulo="Trial"
                      valor={`${c.trial.dias_restantes}d restantes (até ${data(c.trial.fim)})`}
                    />
                  )}
                  {c.acesso_ate && <Campo rotulo="Acesso até" valor={data(c.acesso_ate)} />}
                  {c.cancelado_em && <Campo rotulo="Cancelada em" valor={data(c.cancelado_em)} />}
                </div>

                <Entitlements cliente={c} onMudou={recarregar} />
              </Secao>

              <BillingSecao cliente={c} />

              <Secao titulo={`Usuários (${c.usuarios.length})`}>
                <div className="tabela-wrap">
                  <table className="tabela tabela-densa">
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>E-mail</th>
                        <th>Papel</th>
                        <th>Verificado</th>
                        <th>Ativo</th>
                        <th>Desde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.usuarios.map((u) => (
                        <tr key={u.id}>
                          <td>{u.nome || '—'}</td>
                          <td>{u.email}</td>
                          <td>{u.role}</td>
                          <td>{u.email_verified ? 'sim' : 'não'}</td>
                          <td>{u.ativo ? 'sim' : 'não'}</td>
                          <td>{data(u.criado_em)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Secao>

              <Secao titulo="Atividade recente">
                {c.atividade.length === 0 ? (
                  <p className="muted">Sem eventos registrados.</p>
                ) : (
                  <ul className="atividade">
                    {c.atividade.map((a, i) => (
                      <li key={i}>
                        <span>{a.tipo}</span>
                        <span className="muted">{dataHora(a.criado_em)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>

              <Secao titulo="Produtos">
                {c.produtos.length === 0 ? (
                  <p className="muted nota">
                    Nenhum painel de produto disponível para esta empresa.
                  </p>
                ) : (
                  c.produtos.map((p) => (
                    <div key={p.produto} className="produto-painel">
                      <h3>{p.rotulo || p.produto}</h3>
                      {p._erro ? (
                        <p className="muted nota">Painel indisponível ({p._erro}).</p>
                      ) : (
                        <>
                          <div className="metricas">
                            {p.metricas?.map((m) => (
                              <div key={m.chave} className="metrica">
                                <span className="metrica-valor">{m.valor ?? '—'}</span>
                                <span className="metrica-rotulo muted">{m.rotulo}</span>
                              </div>
                            ))}
                          </div>
                          {p.ultima_atividade && (
                            <p className="muted nota">
                              Última atividade: {dataHora(p.ultima_atividade)}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))
                )}
              </Secao>
            </div>
          </>
        )}
      </Estado>
    </div>
  );
}
