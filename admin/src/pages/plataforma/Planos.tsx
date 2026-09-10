import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';
import { PlataformaTabs } from '../../components/PlataformaTabs';
import { data } from '../../lib/format';

interface Plano {
  chave: string;
  slug: string;
  produto: string;
  nome: string;
  descricao: string | null;
  preco_mensal: number;
  tecnologia: string | null;
  tipo_numero: string | null;
  destaque: boolean;
  badge: string | null;
  herda_de: string | null;
  ativo: boolean;
  atualizado_em: string;
  features: string[];
  limites: Record<string, { valor: number | null; unidade: string | null }>;
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function Planos() {
  const { dados, carregando, erro, recarregar } = useFetch<{ planos: Plano[] }>(
    '/plataforma/planos',
  );

  const porProduto = new Map<string, Plano[]>();
  for (const p of dados?.planos ?? []) {
    if (!porProduto.has(p.produto)) porProduto.set(p.produto, []);
    porProduto.get(p.produto)!.push(p);
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Plataforma</h1>
      </header>
      <PlataformaTabs />

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados &&
          [...porProduto.entries()].map(([produto, planos]) => (
            <section key={produto} className="painel">
              <h2>{produto}</h2>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Plano</th>
                      <th>Preço/mês</th>
                      <th>Tecnologia</th>
                      <th>Limites</th>
                      <th>Features</th>
                      <th>Ativo</th>
                      <th>Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planos.map((p) => (
                      <tr key={p.chave}>
                        <td>
                          <strong>{p.nome}</strong>
                          {p.badge && <span className="muted bloco-menor">{p.badge}</span>}
                          {p.herda_de && (
                            <span className="muted bloco-menor">herda de {p.herda_de}</span>
                          )}
                        </td>
                        <td>{brl(p.preco_mensal)}</td>
                        <td>{p.tecnologia || '—'}</td>
                        <td>
                          {Object.entries(p.limites).length === 0
                            ? '—'
                            : Object.entries(p.limites).map(([k, v]) => (
                                <span key={k} className="bloco-menor">
                                  {k}: {v.valor ?? '—'}
                                  {v.unidade ? ` ${v.unidade}` : ''}
                                </span>
                              ))}
                        </td>
                        <td>{p.features.length}</td>
                        <td>{p.ativo ? 'sim' : 'não'}</td>
                        <td>{data(p.atualizado_em)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        <p className="muted nota">
          Edição de plano com versionamento (spec §12) entra numa leva seguinte — mexer nos limites
          hoje afetaria retroativamente quem já está no plano.
        </p>
      </Estado>
    </div>
  );
}
