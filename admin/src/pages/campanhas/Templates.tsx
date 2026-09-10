import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/useFetch';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { CampanhasTabs } from '../../components/CampanhasTabs';
import { data } from '../../lib/format';

interface TemplateLinha {
  id: string;
  produto: string;
  nome_interno: string;
  categoria: string;
  idioma: string;
  estado: string;
  meta_status: string | null;
  versao: number;
  atualizado_em: string;
}

const PRODUTOS = ['studio', 'people', 'leads', 'crm'];
const ESTADOS = ['rascunho', 'enviado', 'em_analise', 'aprovado', 'rejeitado', 'arquivado'];

const TOM: Record<string, string> = {
  aprovado: 'ok',
  enviado: 'info',
  em_analise: 'info',
  rascunho: 'muted',
  arquivado: 'muted',
  rejeitado: 'danger',
};

export function Templates() {
  const { pode } = useAuth();
  const [params, setParams] = useSearchParams();
  const produto = params.get('produto') ?? '';
  const estado = params.get('estado') ?? '';

  const qs = new URLSearchParams();
  if (produto) qs.set('produto', produto);
  if (estado) qs.set('estado', estado);
  const { dados, carregando, erro, recarregar } = useFetch<{ templates: TemplateLinha[] }>(
    `/templates?${qs}`,
  );

  function setF(k: string, v: string) {
    setParams((p) => {
      v ? p.set(k, v) : p.delete(k);
      return p;
    });
  }

  return (
    <div className="pagina">
      <header className="pagina-header linha-titulo">
        <div>
          <h1>Campanhas</h1>
          <p className="muted">Templates de disparo por produto.</p>
        </div>
        {pode('template:write') && (
          <Link to="/campanhas/novo" className="btn-primario">
            Novo template
          </Link>
        )}
      </header>
      <CampanhasTabs />

      <div className="filtros">
        <select value={produto} onChange={(e) => setF('produto', e.target.value)}>
          <option value="">Produto: todos</option>
          {PRODUTOS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={estado} onChange={(e) => setF('estado', e.target.value)}>
          <option value="">Estado: todos</option>
          {ESTADOS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.templates.length === 0 ? (
          <EmptyState
            titulo="Nenhum template"
            descricao={pode('template:write') ? 'Crie o primeiro com “Novo template”.' : undefined}
          />
        ) : (
          dados && (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Nome interno</th>
                    <th>Produto</th>
                    <th>Categoria</th>
                    <th>Idioma</th>
                    <th>Estado</th>
                    <th>Versão</th>
                    <th>Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.templates.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link to={`/campanhas/${t.id}`} className="link-forte">
                          {t.nome_interno}
                        </Link>
                      </td>
                      <td>{t.produto}</td>
                      <td>{t.categoria}</td>
                      <td>{t.idioma}</td>
                      <td>
                        <span className={`badge badge-${TOM[t.estado] ?? 'muted'}`}>{t.estado}</span>
                      </td>
                      <td>v{t.versao}</td>
                      <td>{data(t.atualizado_em)}</td>
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
