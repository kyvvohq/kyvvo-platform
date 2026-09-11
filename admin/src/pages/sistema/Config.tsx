import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/useFetch';
import { api, ApiError } from '../../lib/api';
import { Estado } from '../../components/Estado';
import { SistemaTabs } from '../../components/SistemaTabs';
import { dataHora } from '../../lib/format';

interface Item {
  chave: string;
  valor: string;
  atualizado_em: string;
}

const ROTULOS: Record<string, string> = {
  trial_dias: 'Dias de trial',
  carencia_dias_inadimplencia: 'Carência de inadimplência (dias)',
  max_tentativas_reenvio_token: 'Máx. reenvios de token',
  email_suporte: 'E-mail de suporte',
  whatsapp_suporte: 'WhatsApp de suporte',
};

export function Config() {
  const { pode } = useAuth();
  const editar = pode('config:write');
  const { dados, carregando, erro, recarregar } = useFetch<{ config: Item[] }>('/sistema/config');

  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (dados) setForm(Object.fromEntries(dados.config.map((i) => [i.chave, i.valor])));
  }, [dados]);

  async function salvar() {
    setOcupado(true);
    setMsg('');
    try {
      await api('/sistema/config', { method: 'PATCH', body: JSON.stringify(form) });
      setMsg('Salvo.');
      recarregar();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Falhou.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pagina">
      <header className="pagina-header">
        <h1>Sistema</h1>
      </header>
      <SistemaTabs />

      {msg && <p className={msg === 'Salvo.' ? 'muted' : 'login-erro'}>{msg}</p>}

      <Estado carregando={carregando} erro={erro} onTentarDeNovo={recarregar}>
        {dados && (
          <section className="painel">
            <h2>Configurações do sistema</h2>
            <p className="muted nota" style={{ marginTop: 0 }}>
              Valores que alimentam constantes centrais (trial, carência…). Valem sem deploy.
            </p>
            <div className="form-grid" style={{ marginTop: 16 }}>
              {dados.config.map((i) => (
                <label key={i.chave}>
                  {ROTULOS[i.chave] ?? i.chave}
                  <input
                    value={form[i.chave] ?? ''}
                    disabled={!editar}
                    onChange={(e) => setForm({ ...form, [i.chave]: e.target.value })}
                  />
                  <span className="muted bloco-menor">
                    <code>{i.chave}</code> · alterado {dataHora(i.atualizado_em)}
                  </span>
                </label>
              ))}
            </div>
            {editar && (
              <button
                type="button"
                className="btn-primario"
                style={{ marginTop: 16 }}
                disabled={ocupado}
                onClick={salvar}
              >
                Salvar
              </button>
            )}
          </section>
        )}
      </Estado>
    </div>
  );
}
