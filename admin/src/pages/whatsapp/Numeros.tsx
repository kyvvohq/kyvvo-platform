import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch';
import { api, ApiError } from '../../lib/api';
import { Estado } from '../../components/Estado';
import { EmptyState } from '../../components/EmptyState';
import { WhatsappTabs } from '../../components/WhatsappTabs';
import { dataHora, telefone } from '../../lib/format';

interface Numero {
  tenant_id: string;
  tenant_nome: string;
  whatsapp: string | null;
  meta_phone_number_id: string;
  tenant_status: string;
  ultima_atividade: string | null;
  falhas_24h: number;
}

interface Resumo {
  numeros: number;
  eventos_24h: number;
  falhas_24h: number;
  mensagens_24h: number;
}

interface StatusMeta {
  ok: boolean;
  erro?: string;
  numero_exibido?: string | null;
  nome_verificado?: string | null;
  quality_rating?: string | null;
  status_verificacao?: string | null;
  platform_type?: string | null;
}

export function Numeros() {
  const { dados: resumo } = useFetch<Resumo>('/whatsapp/resumo');
  const { dados, carregando, erro, recarregar } = useFetch<{ numeros: Numero[] }>(
    '/whatsapp/numeros',
  );
  const [status, setStatus] = useState<Record<string, StatusMeta | 'carregando'>>({});

  async function verStatus(pnid: string) {
    if (status[pnid] && status[pnid] !== 'carregando') {
      setStatus((s) => {
        const c = { ...s };
        delete c[pnid];
        return c;
      });
      return;
    }
    setStatus((s) => ({ ...s, [pnid]: 'carregando' }));
    try {
      const r = await api<StatusMeta>(`/whatsapp/numeros/${pnid}/status`);
      setStatus((s) => ({ ...s, [pnid]: r }));
    } catch (e) {
      setStatus((s) => ({
        ...s,
        [pnid]: { ok: false, erro: e instanceof ApiError ? e.message : 'Falhou.' },
      }));
    }
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>WhatsApp</h1>
        {resumo && (
          <p className="muted resumo-linha">
            {resumo.numeros} números · {resumo.mensagens_24h} mensagens / 24h ·{' '}
            {resumo.eventos_24h} eventos / 24h ·{' '}
            <span className={resumo.falhas_24h > 0 ? 'texto-danger' : undefined}>
              {resumo.falhas_24h} falhas / 24h
            </span>
          </p>
        )}
      </header>
      <WhatsappTabs />

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && dados.numeros.length === 0 ? (
          <EmptyState
            titulo="Nenhum número conectado"
            descricao="Números aparecem aqui quando uma empresa conecta o WhatsApp."
          />
        ) : (
          dados && (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Número</th>
                    <th>Phone Number ID</th>
                    <th>Falhas 24h</th>
                    <th>Última atividade</th>
                    <th>Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.numeros.map((n) => {
                    const st = status[n.meta_phone_number_id];
                    return (
                      <Fragment key={n.meta_phone_number_id}>
                        <tr>
                          <td>
                            <Link to={`/clientes/${n.tenant_id}`} className="link-forte">
                              {n.tenant_nome}
                            </Link>
                          </td>
                          <td>{telefone(n.whatsapp)}</td>
                          <td>
                            <code>{n.meta_phone_number_id}</code>
                          </td>
                          <td className={n.falhas_24h > 0 ? 'texto-danger' : undefined}>
                            {n.falhas_24h}
                          </td>
                          <td>{n.ultima_atividade ? dataHora(n.ultima_atividade) : '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="btn-mini"
                              onClick={() => verStatus(n.meta_phone_number_id)}
                            >
                              {st === 'carregando' ? '…' : st ? 'fechar' : 'status'}
                            </button>
                          </td>
                        </tr>
                        {st && st !== 'carregando' && (
                          <tr>
                            <td colSpan={6} className="muted">
                              {st.ok ? (
                                <span>
                                  quality: <strong>{st.quality_rating ?? '—'}</strong> · verificação:{' '}
                                  {st.status_verificacao ?? '—'} · nome:{' '}
                                  {st.nome_verificado ?? '—'} · {st.numero_exibido ?? '—'}
                                </span>
                              ) : (
                                <span className="texto-danger">Meta indisponível: {st.erro}</span>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
        <p className="muted nota">WABAs (via Graph API da Meta) entram numa leva seguinte.</p>
      </Estado>
    </div>
  );
}
