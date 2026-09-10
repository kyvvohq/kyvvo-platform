import { useAuth } from '../lib/auth';
import { EmptyState } from '../components/EmptyState';

const FASE: Record<string, string> = {
  Clientes: 'Fase 1 — empresas, visão 360° e busca global.',
  Produtos: 'Fase 2 — entitlements e módulos por tenant.',
  Plataforma: 'Fase 2 — planos, assinaturas e billing.',
  WhatsApp: 'Fase 3 — números, WABAs, saúde e logs.',
  Templates: 'Fase 3 — templates de disparo por produto.',
  Sistema: 'Fase 4 — admins, papéis, auditoria e feature flags.',
};

export function Placeholder({ area, perm }: { area: string; perm: string }) {
  const { pode } = useAuth();

  if (!pode(perm)) {
    return (
      <div className="pagina">
        <EmptyState
          titulo="Sem acesso"
          descricao={`Seu perfil não tem a permissão "${perm}".`}
        />
      </div>
    );
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>{area}</h1>
      </header>
      <EmptyState titulo="Em construção" descricao={FASE[area] ?? 'Chega numa fase seguinte.'} />
    </div>
  );
}
