import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { ClientesTabs } from '../../components/ClientesTabs';
import { data } from '../../lib/format';

interface UsuarioGlobal {
  id: string;
  nome: string | null;
  email: string;
  role: string;
  email_verified: boolean;
  ativo: boolean;
  criado_em: string;
  empresa: { id: string; nome: string; excluida: boolean };
}

interface Resposta {
  usuarios: UsuarioGlobal[];
  page: number;
  limit: number;
  total: number;
  total_paginas: number;
}

const LIMITE = 20;

export function UsuariosLista() {
  const [params, setParams] = useSearchParams();
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
  if (params.get('busca')) qs.set('busca', params.get('busca') as string);
  qs.set('page', String(page));
  qs.set('limit', String(LIMITE));

  const { dados, carregando, erro, recarregar } = useFetch<Resposta>(`/usuarios?${qs}`);

  function irPara(p: number) {
    setParams((prev) => {
      prev.set('page', String(p));
      return prev;
    });
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Clientes</h1>
      </header>
      <ClientesTabs />

      <div className="filtros">
        <input
          type="search"
          placeholder="Buscar por e-mail ou nome…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.usuarios.length === 0 ? (
          <EmptyState titulo="Nenhum usuário" descricao="Ajuste a busca." />
        ) : (
          dados && (
            <>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>E-mail</th>
                      <th>Empresa</th>
                      <th>Papel</th>
                      <th>Verificado</th>
                      <th>Desde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.usuarios.map((u) => (
                      <tr key={u.id}>
                        <td>{u.nome || '—'}</td>
                        <td>{u.email}</td>
                        <td>
                          <Link to={`/clientes/${u.empresa.id}`} className="link-forte">
                            {u.empresa.nome}
                          </Link>
                          {u.empresa.excluida && <span className="muted bloco-menor">excluída</span>}
                        </td>
                        <td>{u.role}</td>
                        <td>{u.email_verified ? 'sim' : 'não'}</td>
                        <td>{data(u.criado_em)}</td>
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
                  Página {dados.page} de {dados.total_paginas} · {dados.total} usuários
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
