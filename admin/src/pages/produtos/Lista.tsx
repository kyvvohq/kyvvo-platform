import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';

interface Resposta {
  modulos: {
    key: string;
    nome: string;
    obrigatorio: boolean;
    preco_mensal: number | null;
    tenants_ativos: number;
  }[];
  produtos: { produto: string; planos: number; tenants: number }[];
}

// Área "Produtos" (spec §7) — governança do catálogo. A ativação de módulo
// por empresa é feita na 360° de cada uma (seção Plano & entitlements).
export function ProdutosLista() {
  const { dados, carregando, erro, recarregar } = useFetch<Resposta>('/produtos');

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Produtos</h1>
        <p className="muted">
          Módulos e planos da plataforma. Ligar/desligar por empresa é na 360° de cada uma.
        </p>
      </header>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && (
          <>
            <section className="painel">
              <h2>Produtos</h2>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Planos</th>
                      <th>Empresas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.produtos.map((p) => (
                      <tr key={p.produto}>
                        <td>{p.produto}</td>
                        <td>{p.planos}</td>
                        <td>{p.tenants}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="painel">
              <h2>Módulos</h2>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Módulo</th>
                      <th>Obrigatório</th>
                      <th>Preço/mês</th>
                      <th>Empresas ativas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.modulos.map((m) => (
                      <tr key={m.key}>
                        <td>{m.nome}</td>
                        <td>{m.obrigatorio ? 'sim' : '—'}</td>
                        <td>{m.preco_mensal != null ? `R$ ${m.preco_mensal.toFixed(2)}` : '—'}</td>
                        <td>{m.tenants_ativos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </Estado>
    </div>
  );
}
