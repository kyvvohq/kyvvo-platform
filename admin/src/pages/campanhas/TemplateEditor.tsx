import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { Estado } from '../../components/Estado';
import { ConfirmModal } from '../../components/ConfirmModal';
import { renderizar, type Variavel } from '../../lib/template';
import { dataHora } from '../../lib/format';

const PRODUTOS = ['studio', 'people', 'leads', 'crm'];
const CATEGORIAS = ['utility', 'marketing', 'authentication'];
const EDITAVEL = ['rascunho', 'rejeitado'];

interface Template {
  id: string;
  produto: string;
  nome_interno: string;
  meta_nome: string | null;
  categoria: string;
  idioma: string;
  corpo: string;
  variaveis: Variavel[];
  descricao_uso: string | null;
  estado: string;
  meta_status: string | null;
  meta_motivo_rejeicao: string | null;
  versao: number;
  versoes?: { versao: number; criado_em: string; autor: string | null }[];
}

const VAZIO = {
  produto: 'studio',
  nome_interno: '',
  meta_nome: '',
  categoria: 'utility',
  idioma: 'pt_BR',
  corpo: '',
  variaveis: [] as Variavel[],
  descricao_uso: '',
};

type Form = typeof VAZIO;

export function TemplateEditor() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { pode } = useAuth();
  const podeEscrever = pode('template:write');
  const criando = !id;

  const [form, setForm] = useState<Form>(VAZIO);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [carregando, setCarregando] = useState(!criando);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<'submeter' | 'aprovar' | 'rejeitar' | 'arquivar' | null>(null);
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (criando) return;
    setCarregando(true);
    api<Template>(`/templates/${id}`)
      .then((t) => {
        setTpl(t);
        setForm({
          produto: t.produto,
          nome_interno: t.nome_interno,
          meta_nome: t.meta_nome ?? '',
          categoria: t.categoria,
          idioma: t.idioma,
          corpo: t.corpo,
          variaveis: t.variaveis ?? [],
          descricao_uso: t.descricao_uso ?? '',
        });
      })
      .catch((e) => setErroCarga(e instanceof ApiError ? e.message : 'Erro ao carregar.'))
      .finally(() => setCarregando(false));
  }, [id, criando]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const editavelForm = criando || (tpl != null && EDITAVEL.includes(tpl.estado));
  const soLeitura = !podeEscrever || !editavelForm;

  function setVar(i: number, campo: keyof Variavel, v: string) {
    setForm((f) => {
      const vs = f.variaveis.slice();
      vs[i] = { ...vs[i], [campo]: v };
      return { ...f, variaveis: vs };
    });
  }

  async function salvar() {
    setOcupado(true);
    setErro('');
    try {
      if (criando) {
        const novo = await api<Template>('/templates', { method: 'POST', body: JSON.stringify(form) });
        nav(`/campanhas/${novo.id}`, { replace: true });
      } else {
        const { produto: _p, nome_interno: _n, ...editaveis } = form;
        void _p;
        void _n;
        const atualizado = await api<Template>(`/templates/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(editaveis),
        });
        setTpl((t) => (t ? { ...t, ...atualizado } : t));
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }

  async function acao(fn: () => Promise<unknown>) {
    setOcupado(true);
    setErro('');
    try {
      await fn();
      setDialogo(null);
      const t = await api<Template>(`/templates/${id}`);
      setTpl(t);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falhou.');
    } finally {
      setOcupado(false);
    }
  }

  const preview = renderizar(form.corpo, form.variaveis);

  return (
    <div className="pagina">
      <div className="voltar">
        <Link to="/campanhas" className="muted">
          ← Templates
        </Link>
      </div>

      <Estado carregando={carregando} erro={erroCarga} onTentarDeNovo={() => nav(0)}>
        <header className="pagina-header linha-titulo">
          <div>
            <h1>{criando ? 'Novo template' : form.nome_interno}</h1>
            {tpl && (
              <p className="muted">
                {tpl.produto} · v{tpl.versao} ·{' '}
                <span className={`badge badge-${tpl.estado === 'rejeitado' ? 'danger' : 'muted'}`}>
                  {tpl.estado}
                </span>
                {tpl.meta_status && <span> · Meta: {tpl.meta_status}</span>}
              </p>
            )}
          </div>
        </header>

        {tpl?.meta_motivo_rejeicao && (
          <p className="login-erro">Motivo da rejeição: {tpl.meta_motivo_rejeicao}</p>
        )}
        {erro && <p className="login-erro">{erro}</p>}

        <div className="grade-360">
          <section className="painel">
            <h2>Conteúdo</h2>
            <div className="form-grid">
              <label>
                Produto
                <select
                  value={form.produto}
                  disabled={!criando}
                  onChange={(e) => set('produto', e.target.value)}
                >
                  {PRODUTOS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nome interno
                <input
                  value={form.nome_interno}
                  disabled={!criando}
                  onChange={(e) => set('nome_interno', e.target.value)}
                />
              </label>
              <label>
                Nome na Meta
                <input
                  value={form.meta_nome}
                  disabled={soLeitura}
                  placeholder="lembrete_24h"
                  onChange={(e) => set('meta_nome', e.target.value)}
                />
              </label>
              <label>
                Categoria
                <select
                  value={form.categoria}
                  disabled={soLeitura}
                  onChange={(e) => set('categoria', e.target.value)}
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Idioma
                <input
                  value={form.idioma}
                  disabled={soLeitura}
                  onChange={(e) => set('idioma', e.target.value)}
                />
              </label>
            </div>

            <label className="bloco">
              Corpo
              <textarea
                rows={5}
                value={form.corpo}
                disabled={soLeitura}
                placeholder="Oi {{cliente}}, seu horário é {{data}}."
                onChange={(e) => set('corpo', e.target.value)}
              />
            </label>

            <label className="bloco">
              Descrição de uso
              <input
                value={form.descricao_uso}
                disabled={soLeitura}
                onChange={(e) => set('descricao_uso', e.target.value)}
              />
            </label>

            <div className="bloco">
              <span className="campo-rotulo muted">Variáveis (nome · exemplo)</span>
              {form.variaveis.map((v, i) => (
                <div key={i} className="var-linha">
                  <input
                    value={v.nome}
                    disabled={soLeitura}
                    placeholder="cliente"
                    onChange={(e) => setVar(i, 'nome', e.target.value)}
                  />
                  <input
                    value={v.exemplo}
                    disabled={soLeitura}
                    placeholder="Ana"
                    onChange={(e) => setVar(i, 'exemplo', e.target.value)}
                  />
                  {!soLeitura && (
                    <button
                      type="button"
                      className="btn-mini"
                      onClick={() =>
                        set(
                          'variaveis',
                          form.variaveis.filter((_, j) => j !== i),
                        )
                      }
                    >
                      remover
                    </button>
                  )}
                </div>
              ))}
              {!soLeitura && (
                <button
                  type="button"
                  className="btn-mini btn-mini-on"
                  onClick={() => set('variaveis', [...form.variaveis, { nome: '', exemplo: '' }])}
                >
                  + variável
                </button>
              )}
            </div>

            {podeEscrever && editavelForm && (
              <div className="acoes-linha" style={{ marginTop: 16 }}>
                <button type="button" className="btn-primario" disabled={ocupado} onClick={salvar}>
                  {criando ? 'Criar' : 'Salvar alterações'}
                </button>
                {!criando && (
                  <button
                    type="button"
                    className="btn-plano"
                    disabled={ocupado}
                    onClick={() => setDialogo('submeter')}
                  >
                    Submeter à Meta
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="painel">
            <h2>Preview</h2>
            <pre className="payload">{preview || '—'}</pre>

            {tpl && !EDITAVEL.includes(tpl.estado) && podeEscrever && tpl.estado !== 'arquivado' && (
              <div className="acoes-linha" style={{ marginTop: 16 }}>
                {['enviado', 'em_analise'].includes(tpl.estado) && (
                  <>
                    <button
                      type="button"
                      className="btn-primario"
                      onClick={() => setDialogo('aprovar')}
                    >
                      Marcar aprovado
                    </button>
                    <button
                      type="button"
                      className="btn-perigo"
                      onClick={() => setDialogo('rejeitar')}
                    >
                      Marcar rejeitado
                    </button>
                  </>
                )}
                <button type="button" className="btn-plano" onClick={() => setDialogo('arquivar')}>
                  Arquivar
                </button>
              </div>
            )}

            {tpl?.versoes && tpl.versoes.length > 0 && (
              <>
                <h2 style={{ marginTop: 24 }}>Histórico</h2>
                <ul className="atividade">
                  {tpl.versoes.map((v) => (
                    <li key={v.versao}>
                      <span>v{v.versao}</span>
                      <span className="muted">
                        {dataHora(v.criado_em)}
                        {v.autor ? ` · ${v.autor}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </Estado>

      {dialogo === 'submeter' && (
        <ConfirmModal
          titulo="Submeter à Meta"
          confirmarLabel="Submeter"
          ocupado={ocupado}
          onCancelar={() => setDialogo(null)}
          onConfirmar={() => acao(() => api(`/templates/${id}/submeter`, { method: 'POST' }))}
        >
          <p>
            Marca o template como <strong>enviado</strong>. A submissão real à Graph API entra
            quando a integração de Tech Provider existir.
          </p>
        </ConfirmModal>
      )}
      {dialogo === 'aprovar' && (
        <ConfirmModal
          titulo="Marcar aprovado"
          confirmarLabel="Aprovar"
          ocupado={ocupado}
          onCancelar={() => setDialogo(null)}
          onConfirmar={() =>
            acao(() =>
              api(`/templates/${id}/estado`, {
                method: 'POST',
                body: JSON.stringify({ estado: 'aprovado' }),
              }),
            )
          }
        >
          <p>Sincroniza o veredito da Meta: template aprovado.</p>
        </ConfirmModal>
      )}
      {dialogo === 'rejeitar' && (
        <ConfirmModal
          titulo="Marcar rejeitado"
          perigoso
          confirmarLabel="Rejeitar"
          ocupado={ocupado}
          onCancelar={() => setDialogo(null)}
          onConfirmar={() =>
            acao(() =>
              api(`/templates/${id}/estado`, {
                method: 'POST',
                body: JSON.stringify({ estado: 'rejeitado', motivo }),
              }),
            )
          }
        >
          <p>Sincroniza o veredito da Meta: template rejeitado.</p>
          <input
            placeholder="Motivo (opcional)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            style={{ width: '100%', marginTop: 8 }}
          />
        </ConfirmModal>
      )}
      {dialogo === 'arquivar' && (
        <ConfirmModal
          titulo="Arquivar template"
          perigoso
          confirmarLabel="Arquivar"
          ocupado={ocupado}
          onCancelar={() => setDialogo(null)}
          onConfirmar={() =>
            acao(() =>
              api(`/templates/${id}/estado`, {
                method: 'POST',
                body: JSON.stringify({ estado: 'arquivado' }),
              }),
            )
          }
        >
          <p>Some das listagens ativas. Não dá pra desarquivar por aqui.</p>
        </ConfirmModal>
      )}
    </div>
  );
}
