import type { ReactNode } from 'react';

export function ConfirmModal({
  titulo,
  children,
  confirmarLabel = 'Confirmar',
  perigoso = false,
  ocupado = false,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  children: ReactNode;
  confirmarLabel?: string;
  perigoso?: boolean;
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancelar}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{titulo}</h2>
        <div className="modal-corpo">{children}</div>
        <div className="modal-acoes">
          <button type="button" className="btn-plano" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
          <button
            type="button"
            className={perigoso ? 'btn-perigo' : 'btn-primario'}
            onClick={onConfirmar}
            disabled={ocupado}
          >
            {ocupado ? '…' : confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
