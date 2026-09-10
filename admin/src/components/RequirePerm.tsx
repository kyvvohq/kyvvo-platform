import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { EmptyState } from './EmptyState';

// Gate de rota por permissão. O menu já esconde o item; isto cobre o acesso
// por URL direta.
export function RequirePerm({ perm, children }: { perm: string; children: ReactNode }) {
  const { pode } = useAuth();
  if (!pode(perm)) {
    return (
      <div className="pagina">
        <EmptyState titulo="Sem acesso" descricao={`Seu perfil não tem a permissão "${perm}".`} />
      </div>
    );
  }
  return <>{children}</>;
}
