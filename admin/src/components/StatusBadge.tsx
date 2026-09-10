// Pílula de status derivado (statusContaTenant no backend).
const TOM: Record<string, string> = {
  Ativo: 'ok',
  'Trial ativo': 'info',
  'Trial expirado': 'warn',
  Suspenso: 'danger',
  Inativo: 'muted',
  'Não ativado': 'muted',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${TOM[status] ?? 'muted'}`}>{status}</span>;
}
