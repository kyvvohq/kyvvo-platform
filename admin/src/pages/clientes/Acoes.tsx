import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/useFetch';
import { api, ApiError } from '../../lib/api';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { Cliente360, FiltrosCatalogo } from './types';

type Dialogo = null | 'suspender' | 'reativar' | 'plano';

// Ações sensíveis da 360° (spec §6) — confirmação + AuditEvent no backend.
// Só aparece o que a permissão do admin libera.
export function Acoes({ cliente, onMudou }: { cliente: Cliente360; onMudou: () => void }) {
  const { pode } = useAuth();
  const podeStatus = pode('clientes:suspend');
  const podePlano = pode('plano:alterar');

  const { dados: filtros } = useFetch<FiltrosCatalogo>(podePlano ? '/clientes/filtros' : null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [planoNovo, setPlanoNovo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  if (!podeStatus && !podePlano) return null;

  async function executar(fn: () => Promise<unknown>) {
    setOcupado(true);
    setErro('');
    try {
      await fn();
      setDialogo(null);
      onMudou();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  const suspenso = cliente.status === 'suspenso';
  const nomePlanoNovo = filtros?.planos.find((p) => p.chave === planoNovo)?.nome;

  return (
    <section className="painel">
      <h2>Ações</h2>
      {erro && <p className="login-erro">{erro}</p>}

      <div className="acoes-linha">
        {podeStatus && !suspenso && (
          <button type="button" className="btn-perigo" onClick={() => setDialogo('suspender')}>
            Suspender empresa
          </button>
        )}
        {podeStatus && suspenso && (
          <button type="button" className="btn-primario" onClick={() => setDialogo('reativar')}>
            Reativar empresa
          </button>
        )}
        {podePlano && (
          <div className="acao-plano">
            <select value={planoNovo} onChange={(e) => setPlanoNovo(e.target.value)}>
              <option value="">Alterar plano…</option>
              {filtros?.planos.map((p) => (
                <option key={p.chave} value={p.chave} disabled={p.chave === cliente.plano.chave}>
                  {p.nome}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-plano"
              disabled={!planoNovo}
              onClick={() => setDialogo('plano')}
            >
              Alterar
            </button>
          </div>
        )}
      </div>

      {dialogo === 'suspender' && (
        <ConfirmModal
          titulo="Suspender empresa"
          perigoso
          confirmarLabel="Suspender"
          ocupado={ocupado}
          onCancelar={() => setDialogo(null)}
          onConfirmar={() =>
            executar(() => api(`/clientes/${cliente.id}/suspender`, { method: 'POST' }))
          }
        >
          <p>
            <strong>{cliente.nome}</strong> perde o acesso ao produto até ser reativada. A ação fica
            registrada na auditoria.
          </p>
        </ConfirmModal>
      )}

      {dialogo === 'reativar' && (
        <ConfirmModal
          titulo="Reativar empresa"
          confirmarLabel="Reativar"
          ocupado={ocupado}
          onCancelar={() => setDialogo(null)}
          onConfirmar={() =>
            executar(() => api(`/clientes/${cliente.id}/reativar`, { method: 'POST' }))
          }
        >
          <p>
            <strong>{cliente.nome}</strong> volta ao status ativo.
          </p>
        </ConfirmModal>
      )}

      {dialogo === 'plano' && (
        <ConfirmModal
          titulo="Alterar plano"
          confirmarLabel="Alterar"
          ocupado={ocupado}
          onCancelar={() => setDialogo(null)}
          onConfirmar={() =>
            executar(() =>
              api(`/clientes/${cliente.id}/plano`, {
                method: 'PATCH',
                body: JSON.stringify({ plano: planoNovo }),
              }),
            )
          }
        >
          <p>
            Plano de <strong>{cliente.nome}</strong>: {cliente.plano.nome} → {nomePlanoNovo}. Não
            altera a cobrança na Asaas.
          </p>
        </ConfirmModal>
      )}
    </section>
  );
}
