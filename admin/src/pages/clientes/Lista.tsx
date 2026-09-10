import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import { data, telefone } from '../../lib/format';
import type { ClientesResposta, FiltrosCatalogo, ResumoClientes } from './types';

const LIMITE = 20;

export function Lista() {
  const [params, setParams] = useSearchParams();
  const { dados: filtros } = useFetch<FiltrosCatalogo>('/clientes/filtros');
  const { dados: resumo } = useFetch<ResumoClientes>('/clientes/resumo');

  // Campo de busca com debounce; os demais filtros aplicam na hora.
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  useEffect(() => {
    const t = setTimeout(() => {
      setParams(
        (p) => {
          busca ? p.set('busca', busca) : p.delete('busca');
          p.delete('page');
          return p;
        },
        { replace: true },
      );
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  const page = Math.max(parseInt(params.get('page') ?? '1', 10) || 1, 1);
  const qs = new URLSearchParams();
  for (const k of ['busca', 'status', 'plano', 'modulo', 'whatsapp']) {
    const v = params.get(k);
    if (v) qs.set(k, v);
  }
  qs.set('page', String(page));
  qs.set('limit', String(LIMITE));

  const { dados, carregando, erro, recarregar } = useFetch<ClientesResposta>(`/clientes?${qs}`);

  function setFiltro(chave: string, valor: string) {
    setParams((p) => {
      valor ? p.set(chave, valor) : p.delete(chave);
      p.delete('page');
      return p;
    });
  }
  function irPara(p: number) {
    setParams((prev) => {
      prev.set('page', String(p));
      return prev;
    });
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Empresas</h1>
        {resumo && (
          <p className="muted">
            {resumo.total} no total · {resumo.ativos} ativas · {resumo.trial} em trial ·{' '}
            {resumo.inativos} inativas · {resumo.novos_mes} novas no mês
          </p>
        )}
      </header>

      <div className="filtros">
        <input
          type="search"
          placeholder="Buscar nome, telefone, e-mail…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select value={params.get('status') ?? ''} onChange={(e) => setFiltro('status', e.target.value)}>
          <option value="">Status: todos</option>
          {filtros?.status.map((s) => (
            <option key={s.chave} value={s.chave}>
              {s.rotulo}
            </option>
          ))}
        </select>
        <select value={params.get('plano') ?? ''} onChange={(e) => setFiltro('plano', e.target.value)}>
          <option value="">Plano: todos</option>
          {filtros?.planos.map((p) => (
            <option key={p.chave} value={p.chave}>
              {p.nome}
            </option>
          ))}
        </select>
        <select value={params.get('modulo') ?? ''} onChange={(e) => setFiltro('modulo', e.target.value)}>
          <option value="">Módulo: qualquer</option>
          {filtros?.modulos.map((m) => (
            <option key={m.key} value={m.key}>
              {m.nome}
            </option>
          ))}
        </select>
        <select
          value={params.get('whatsapp') ?? ''}
          onChange={(e) => setFiltro('whatsapp', e.target.value)}
        >
          <option value="">WhatsApp: tanto faz</option>
          <option value="sim">Conectado</option>
          <option value="nao">Sem número</option>
        </select>
      </div>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.clientes.length === 0 ? (
          <EmptyState titulo="Nenhuma empresa" descricao="Ajuste a busca ou os filtros." />
        ) : (
          dados && (
            <>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Empresa</th>
                      <th>Responsável</th>
                      <th>Plano</th>
                      <th>Status</th>
                      <th>WhatsApp</th>
                      <th>Usuários</th>
                      <th>Cadastro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.clientes.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/clientes/${c.id}`} className="link-forte">
                            {c.nome}
                          </Link>
                        </td>
                        <td>
                          {c.responsavel_nome || '—'}
                          {c.responsavel_email && (
                            <span className="muted bloco-menor">{c.responsavel_email}</span>
                          )}
                        </td>
                        <td>{c.plano_nome}</td>
                        <td>
                          <StatusBadge status={c.status_conta} />
                          {c.status_conta === 'Trial ativo' && c.trial_dias_restantes != null && (
                            <span className="muted bloco-menor">{c.trial_dias_restantes}d restantes</span>
                          )}
                        </td>
                        <td>{c.whatsapp_conectado ? telefone(c.whatsapp) : '—'}</td>
                        <td>{c.total_usuarios}</td>
                        <td>{data(c.criado_em)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="paginacao">
                <button type="button" disabled={page <= 1} onClick={() => irPara(page - 1)}>
                  ← Anterior
                </button>
                <span className="muted">
                  Página {dados.page} de {dados.total_paginas} · {dados.total} empresas
                </span>
                <button
                  type="button"
                  disabled={page >= dados.total_paginas}
                  onClick={() => irPara(page + 1)}
                >
                  Próxima →
                </button>
              </div>
            </>
          )
        )}
      </Estado>
    </div>
  );
}
