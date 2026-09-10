import type { ReactNode } from 'react';

export function EmptyState({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{titulo}</h2>
      {descricao && <p className="muted">{descricao}</p>}
      {acao}
    </div>
  );
}
