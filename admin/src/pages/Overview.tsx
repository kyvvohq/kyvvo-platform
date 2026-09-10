import { useAuth } from '../lib/auth';

// Visão geral (spec §5) — home operacional. Os KPIs reais (clientes,
// produtos, WhatsApp, IA) e os alertas de exceção entram na Fase 4, quando
// as leituras da Admin API existirem. Por ora, o esqueleto + o que já dá
// pra mostrar sem backend novo.
const KPIS = [
  { rotulo: 'Clientes', valor: '—', hint: 'total · ativos · trial' },
  { rotulo: 'Produtos ativos', valor: '—', hint: 'por produto' },
  { rotulo: 'WhatsApp', valor: '—', hint: 'números · atenção · críticos' },
  { rotulo: 'IA', valor: '—', hint: 'conversas · tokens · custo' },
];

export function Overview() {
  const { admin } = useAuth();

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Visão geral</h1>
        <p className="muted">
          Bem-vindo{admin?.nome ? `, ${admin.nome}` : ''}. Central de operação da plataforma.
        </p>
      </header>

      <section className="kpi-grid">
        {KPIS.map((k) => (
          <article key={k.rotulo} className="kpi-card">
            <span className="kpi-rotulo">{k.rotulo}</span>
            <strong className="kpi-valor">{k.valor}</strong>
            <span className="kpi-hint muted">{k.hint}</span>
          </article>
        ))}
      </section>

      <section className="painel">
        <h2>Alertas de atenção</h2>
        <p className="muted">
          Sem fonte de dados ainda — quality baixa, WhatsApp desconectado, template rejeitado,
          falha de integração e pagamento em atraso aparecem aqui na Fase 4.
        </p>
      </section>
    </div>
  );
}
