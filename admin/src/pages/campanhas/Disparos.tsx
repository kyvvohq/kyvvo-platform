import { EmptyState } from '../../components/EmptyState';
import { CampanhasTabs } from '../../components/CampanhasTabs';

export function Disparos() {
  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Campanhas</h1>
      </header>
      <CampanhasTabs />
      <EmptyState
        titulo="Disparos"
        descricao="Campanhas (audiência, janela de envio, relatórios) entram quando o mecanismo de dispatch existir. A interface não muda — só passa a ler dados reais."
      />
    </div>
  );
}
