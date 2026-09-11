import { useSearchParams } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { WhatsappTabs } from '../../components/WhatsappTabs';
import { data } from '../../lib/format';

interface IaUso {
  periodo: { dias: number };
  resumo: {
    mensagens: number;
    tenants_ativos: number;
    tokens_entrada: number;
    tokens_saida: number;
    custo_brl: number;
  };
  por_dia: { dia: string; mensagens: number; custo_brl: number }[];
  por_tenant: {
    tenant_id: string;
    tenant_nome: string;
    mensagens: number;
    conversas: number;
    custo_brl: number;
  }[];
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function IaUso() {
  const [params, setParams] = useSearchParams();
  const dias = params.get('dias') ?? '30';
  const { dados, carregando, erro, recarregar } = useFetch<IaUso>(`/whatsapp/ia-uso?dias=${dias}`);

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>WhatsApp</h1>
      </header>
      <WhatsappTabs />

      <div className="filtros">
        <select value={dias} onChange={(e) => setParams({ dias: e.target.value })}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
        </select>
      </div>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && (
          <>
            <section className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-rotulo">Mensagens</span>
                <strong className="kpi-valor">{dados.resumo.mensagens}</strong>
                <span className="kpi-hint muted">{dados.resumo.tenants_ativos} empresas</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-rotulo">Custo estimado</span>
                <strong className="kpi-valor">{brl(dados.resumo.custo_brl)}</strong>
                <span className="kpi-hint muted">no período</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-rotulo">Tokens</span>
                <strong className="kpi-valor">
                  {(dados.resumo.tokens_entrada + dados.resumo.tokens_saida).toLocaleString('pt-BR')}
                </strong>
                <span className="kpi-hint muted">entrada + saída</span>
              </div>
            </section>

            <section className="painel">
              <h2>Por empresa</h2>
              {dados.por_tenant.length === 0 ? (
                <EmptyState titulo="Sem consumo no período" />
              ) : (
                <div className="tabela-wrap">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Empresa</th>
                        <th>Mensagens</th>
                        <th>Conversas</th>
                        <th>Custo estimado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.por_tenant.map((t) => (
                        <tr key={t.tenant_id}>
                          <td>{t.tenant_nome}</td>
                          <td>{t.mensagens}</td>
                          <td>{t.conversas}</td>
                          <td>{brl(t.custo_brl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {dados.por_dia.length > 0 && (
              <section className="painel">
                <h2>Por dia</h2>
                <ul className="atividade">
                  {dados.por_dia.map((d) => (
                    <li key={d.dia}>
                      <span>{data(d.dia)}</span>
                      <span className="muted">
                        {d.mensagens} msg · {brl(d.custo_brl)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="muted nota">Custo estimado com cotação fixa aproximada — não é o valor faturado.</p>
          </>
        )}
      </Estado>
    </div>
  );
}
