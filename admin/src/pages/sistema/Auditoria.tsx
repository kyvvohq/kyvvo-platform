import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { SistemaTabs } from '../../components/SistemaTabs';
import { dataHora } from '../../lib/format';

interface Evento {
  id: string;
  acao: string;
  entidade_tipo: string | null;
  entidade_id: string | null;
  tenant_id: string | null;
  valor_antes: unknown;
  valor_depois: unknown;
  ip: string | null;
  criado_em: string;
  ator_nome: string | null;
  ator_email: string | null;
}

interface Resposta {
  eventos: Evento[];
  page: number;
  limit: number;
  total: number;
  total_paginas: number;
}

function resumo(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}=${JSON.stringify(val)}`)
      .join(' ');
  }
  return String(v);
}

export function Auditoria() {
  const [params, setParams] = useSearchParams();
  const [acao, setAcao] = useState(params.get('acao') ?? '');
  const [ator, setAtor] = useState(params.get('ator') ?? '');

  useEffect(() => {
    const t = setTimeout(() => {
      setParams(
        (p) => {
          acao ? p.set('acao', acao) : p.delete('acao');
          ator ? p.set('ator', ator) : p.delete('ator');
          p.delete('page');
          return p;
        },
        { replace: true },
      );
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acao, ator]);

  const page = Math.max(parseInt(params.get('page') ?? '1', 10) || 1, 1);
  const qs = new URLSearchParams({ page: String(page), limit: '30' });
  if (params.get('acao')) qs.set('acao', params.get('acao') as string);
  if (params.get('ator')) qs.set('ator', params.get('ator') as string);

  const { dados, carregando, erro, recarregar } = useFetch<Resposta>(
    `/sistema/auditoria?${qs}`,
  );

  function irPara(p: number) {
    setParams((prev) => {
      prev.set('page', String(p));
      return prev;
    });
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Sistema</h1>
      </header>
      <SistemaTabs />

      <div className="filtros">
        <input
          type="search"
          placeholder="Ação (ex.: tenant.suspender)"
          value={acao}
          onChange={(e) => setAcao(e.target.value)}
        />
        <input
          type="search"
          placeholder="Ator (nome ou e-mail)"
          value={ator}
          onChange={(e) => setAtor(e.target.value)}
        />
      </div>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.eventos.length === 0 ? (
          <EmptyState titulo="Nenhum evento" descricao="Ajuste os filtros." />
        ) : (
          dados && (
            <>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Ator</th>
                      <th>Ação</th>
                      <th>Entidade</th>
                      <th>Antes → depois</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.eventos.map((e) => (
                      <tr key={e.id}>
                        <td>{dataHora(e.criado_em)}</td>
                        <td>{e.ator_nome || e.ator_email || '—'}</td>
                        <td>
                          <code>{e.acao}</code>
                        </td>
                        <td>
                          {e.entidade_tipo || '—'}
                          {e.entidade_id && (
                            <span className="muted bloco-menor">{e.entidade_id}</span>
                          )}
                        </td>
                        <td className="muted">
                          {resumo(e.valor_antes)}
                          {e.valor_antes != null && e.valor_depois != null ? ' → ' : ''}
                          {resumo(e.valor_depois)}
                        </td>
                        <td>{e.ip || '—'}</td>
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
                  Página {dados.page} de {dados.total_paginas} · {dados.total} eventos
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
