import type { ReactNode } from 'react';

// Loading / erro padrão pras telas (spec §18.6). O estado `empty` cada tela
// resolve do seu jeito (EmptyState), porque o texto depende do contexto.
export function Estado({
  carregando,
  erro,
  onTentarDeNovo,
  children,
}: {
  carregando: boolean;
  erro: string | null;
  onTentarDeNovo?: () => void;
  children: ReactNode;
}) {
  if (carregando) return <div className="estado muted">Carregando…</div>;
  if (erro) {
    return (
      <div className="estado estado-erro" role="alert">
        <span>{erro}</span>
        {onTentarDeNovo && (
          <button type="button" onClick={onTentarDeNovo}>
            Tentar de novo
          </button>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
