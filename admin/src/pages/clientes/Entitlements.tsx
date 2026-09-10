import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { Cliente360 } from './types';

type Modulo = Cliente360['entitlements']['modulos'][number];

// Módulos/entitlements do tenant na 360°. Com `plano:alterar`, cada módulo
// não-obrigatório ganha um toggle (desativar pede confirmação — corta acesso;
// ativar é aditivo, vai direto). Toda troca é auditada no backend.
export function Entitlements({ cliente, onMudou }: { cliente: Cliente360; onMudou: () => void }) {
  const { pode } = useAuth();
  const editavel = pode('plano:alterar');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [confirmar, setConfirmar] = useState<Modulo | null>(null);

  async function aplicar(m: Modulo, ativo: boolean) {
    setOcupado(m.key);
    setErro('');
    try {
      await api(`/clientes/${cliente.id}/modulos/${m.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ ativo }),
      });
      setConfirmar(null);
      onMudou();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(null);
    }
  }

  const limites = Object.entries(cliente.entitlements.limites);

  return (
    <>
      {erro && <p className="login-erro">{erro}</p>}

      <ul className="entitlements">
        {cliente.entitlements.modulos.map((m) => (
          <li key={m.key}>
            <span>
              {m.nome}
              {m.obrigatorio && <span className="muted"> · obrigatório</span>}
            </span>
            {editavel && !m.obrigatorio ? (
              m.ativo ? (
                <button
                  type="button"
                  className="btn-mini"
                  disabled={ocupado === m.key}
                  onClick={() => setConfirmar(m)}
                >
                  Desativar
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-mini btn-mini-on"
                  disabled={ocupado === m.key}
                  onClick={() => aplicar(m, true)}
                >
                  Ativar
                </button>
              )
            ) : (
              <span className={`badge badge-${m.ativo ? 'ok' : 'muted'}`}>
                {m.ativo ? 'ativo' : 'inativo'}
              </span>
            )}
          </li>
        ))}
      </ul>

      {limites.length > 0 && (
        <ul className="limites">
          {limites.map(([k, v]) => (
            <li key={k}>
              <span className="muted">{k}</span>
              <strong>
                {v.valor ?? '—'}
                {v.unidade ? ` ${v.unidade}` : ''}
              </strong>
            </li>
          ))}
        </ul>
      )}

      {confirmar && (
        <ConfirmModal
          titulo={`Desativar "${confirmar.nome}"`}
          perigoso
          confirmarLabel="Desativar"
          ocupado={ocupado === confirmar.key}
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => aplicar(confirmar, false)}
        >
          <p>
            <strong>{cliente.nome}</strong> perde o acesso ao módulo{' '}
            <strong>{confirmar.nome}</strong>. A ação fica registrada na auditoria.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
