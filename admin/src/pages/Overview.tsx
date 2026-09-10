import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/useFetch';
import { Estado } from '../components/Estado';

interface VisaoGeral {
  clientes: { total: number; ativos: number; trial: number; inativos: number; novos_mes: number };
  produtos: { produto: string; tenants: number }[];
  whatsapp: { numeros: number; eventos_24h: number; falhas_24h: number };
  alertas: { tipo: string; severidade: string; texto: string; href: string }[];
}

function Kpi({
  rotulo,
  valor,
  hint,
  to,
}: {
  rotulo: string;
  valor: number | string;
  hint?: string;
  to: string;
}) {
  return (
    <Link to={to} className="kpi-card kpi-link">
      <span className="kpi-rotulo">{rotulo}</span>
      <strong className="kpi-valor">{valor}</strong>
      {hint && <span className="kpi-hint muted">{hint}</span>}
    </Link>
  );
}

export function Overview() {
  const { admin } = useAuth();
  const { dados, carregando, erro, recarregar } = useFetch<VisaoGeral>('/visao-geral');

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Visão geral</h1>
        <p className="muted">
          Bem-vindo{admin?.nome ? `, ${admin.nome}` : ''}. Central de operação da plataforma.
        </p>
      </header>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && (
          <>
            <section>
              <h2 className="secao-titulo">Clientes</h2>
              <div className="kpi-grid">
                <Kpi rotulo="Total" valor={dados.clientes.total} to="/clientes" />
                <Kpi
                  rotulo="Ativas"
                  valor={dados.clientes.ativos}
                  to="/clientes?status=ativo"
                />
                <Kpi
                  rotulo="Em trial"
                  valor={dados.clientes.trial}
                  to="/clientes?status=trial"
                />
                <Kpi
                  rotulo="Inativas"
                  valor={dados.clientes.inativos}
                  to="/clientes?status=inativo"
                />
                <Kpi
                  rotulo="Novas no mês"
                  valor={dados.clientes.novos_mes}
                  to="/clientes?order_by=criado_em&order_dir=desc"
                />
              </div>
            </section>

            <section>
              <h2 className="secao-titulo">Produtos</h2>
              <div className="kpi-grid">
                {dados.produtos.map((p) => (
                  <Kpi
                    key={p.produto}
                    rotulo={p.produto}
                    valor={p.tenants}
                    hint="empresas"
                    to="/produtos"
                  />
                ))}
              </div>
            </section>

            <section>
              <h2 className="secao-titulo">WhatsApp</h2>
              <div className="kpi-grid">
                <Kpi rotulo="Números" valor={dados.whatsapp.numeros} to="/whatsapp" />
                <Kpi
                  rotulo="Eventos / 24h"
                  valor={dados.whatsapp.eventos_24h}
                  to="/whatsapp/eventos"
                />
                <Kpi
                  rotulo="Falhas / 24h"
                  valor={dados.whatsapp.falhas_24h}
                  to="/whatsapp/eventos?tipo=status"
                />
              </div>
            </section>

            <section className="painel">
              <h2>Alertas de atenção</h2>
              {dados.alertas.length === 0 ? (
                <p className="muted">Nada exigindo ação agora.</p>
              ) : (
                <ul className="alertas">
                  {dados.alertas.map((a, i) => (
                    <li key={i} className={`alerta alerta-${a.severidade}`}>
                      <Link to={a.href}>{a.texto}</Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted nota">
                IA (conversas, tokens, custo) entra aqui quando vier pelo adapter de produto.
              </p>
            </section>
          </>
        )}
      </Estado>
    </div>
  );
}
