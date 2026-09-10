import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch';
import { api } from '../../lib/api';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { WhatsappTabs } from '../../components/WhatsappTabs';
import { ConfirmModal } from '../../components/ConfirmModal';
import { dataHora } from '../../lib/format';

interface Evento {
  id: string;
  phone_number_id: string | null;
  tipo: string;
  destino: string | null;
  encaminhado: boolean;
  recebido_em: string;
}

interface EventoDetalhe extends Evento {
  payload: unknown;
}

export function Eventos() {
  const [params, setParams] = useSearchParams();
  const tipo = params.get('tipo') ?? '';
  const qs = new URLSearchParams({ limit: '80' });
  if (tipo) qs.set('tipo', tipo);

  const { dados, carregando, erro, recarregar } = useFetch<{ eventos: Evento[] }>(
    `/whatsapp/eventos?${qs}`,
  );
  const [detalhe, setDetalhe] = useState<EventoDetalhe | null>(null);

  async function abrir(id: string) {
    try {
      setDetalhe(await api<EventoDetalhe>(`/whatsapp/eventos/${id}`));
    } catch {
      /* silencioso — o botão só falha se o evento sumiu */
    }
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>WhatsApp</h1>
      </header>
      <WhatsappTabs />

      <div className="filtros">
        <select
          value={tipo}
          onChange={(e) =>
            setParams((p) => {
              e.target.value ? p.set('tipo', e.target.value) : p.delete('tipo');
              return p;
            })
          }
        >
          <option value="">Tipo: todos</option>
          <option value="mensagem">Mensagem</option>
          <option value="status">Status</option>
          <option value="outro">Outro</option>
        </select>
      </div>

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.eventos.length === 0 ? (
          <EmptyState titulo="Nenhum evento" descricao="Nada recebido da Meta ainda." />
        ) : (
          dados && (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Recebido</th>
                    <th>Tipo</th>
                    <th>Phone Number ID</th>
                    <th>Encaminhado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dados.eventos.map((e) => (
                    <tr key={e.id}>
                      <td>{dataHora(e.recebido_em)}</td>
                      <td>{e.tipo}</td>
                      <td>
                        <code>{e.phone_number_id || '—'}</code>
                      </td>
                      <td>{e.encaminhado ? 'sim' : 'não'}</td>
                      <td>
                        <button type="button" className="btn-mini" onClick={() => abrir(e.id)}>
                          Payload
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Estado>

      {detalhe && (
        <ConfirmModal
          titulo="Payload do evento"
          confirmarLabel="Fechar"
          onCancelar={() => setDetalhe(null)}
          onConfirmar={() => setDetalhe(null)}
        >
          <pre className="payload">{JSON.stringify(detalhe.payload, null, 2)}</pre>
        </ConfirmModal>
      )}
    </div>
  );
}
