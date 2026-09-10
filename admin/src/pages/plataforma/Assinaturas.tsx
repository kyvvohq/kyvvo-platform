import { Link } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { PlataformaTabs } from '../../components/PlataformaTabs';
import { StatusBadge } from '../../components/StatusBadge';
import { data } from '../../lib/format';

interface Assinatura {
  id: string;
  nome: string;
  status_conta: string;
  plano_nome: string | null;
  valor_plano: number | null;
  proxima_cobranca: string | null;
  meio_pagamento: string | null;
  cartao_final: string | null;
  tem_assinatura_asaas: boolean;
}

function brl(v: number | null) {
  return v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function Assinaturas() {
  const { dados, carregando, erro, recarregar } = useFetch<{ assinaturas: Assinatura[] }>(
    '/plataforma/assinaturas',
  );

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Plataforma</h1>
      </header>
      <PlataformaTabs />

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.assinaturas.length === 0 ? (
          <EmptyState titulo="Nenhuma assinatura" />
        ) : (
          dados && (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Status</th>
                    <th>Plano</th>
                    <th>Valor/mês</th>
                    <th>Próxima cobrança</th>
                    <th>Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.assinaturas.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/clientes/${a.id}`} className="link-forte">
                          {a.nome}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={a.status_conta} />
                      </td>
                      <td>{a.plano_nome || '—'}</td>
                      <td>{brl(a.valor_plano)}</td>
                      <td>{a.proxima_cobranca ? data(a.proxima_cobranca) : '—'}</td>
                      <td>
                        {a.meio_pagamento || '—'}
                        {a.cartao_final && (
                          <span className="muted bloco-menor">final {a.cartao_final}</span>
                        )}
                        {!a.tem_assinatura_asaas && (
                          <span className="muted bloco-menor">sem assinatura Asaas</span>
                        )}
                      </td>
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
