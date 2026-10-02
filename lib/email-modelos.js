// Modelos de e-mail editáveis pelo admin (tabelas email_modelos /
// email_configuracoes, db/011). O produto manda `modelo` (chave) +
// `variaveis` + o conteúdo dinâmico em `layout` (link do botão, detalhes,
// código); os textos vêm do modelo. Cache curto (60s): edição no admin vale
// em até 1 minuto, sem deploy.

const CACHE_MS = 60 * 1000;

// Defaults do rodapé — os mesmos valores semeados em email_configuracoes;
// valem se a tabela estiver vazia/inacessível.
const CONFIG_PADRAO = {
  rodape_nao_responda: 'Este é um e-mail automático — não é necessário respondê-lo.',
  rodape_notificacao: 'Você recebeu este e-mail porque a notificação "{{notificacao}}" está ativada para o canal e-mail.',
  rodape_desativar: 'Você pode desativá-la a qualquer momento em {{caminho}}.',
  caminho_notificacoes_studio: 'Studio → Configurações → Notificações',
  caminho_notificacoes_studio_url: 'https://studio.kyvvo.com.br/painel.html',
  caminho_notificacoes_crm: 'CRM → Configurações → Notificações',
  caminho_notificacoes_crm_url: 'https://crm.kyvvo.com.br/crm/notificacoes.html',
};

// {{nome}} ou {{nome|padrão se vazio}}. Variável desconhecida/vazia sem
// padrão vira ''.
function substituir(texto, variaveis = {}) {
  return String(texto == null ? '' : texto).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g, (_, nome, padrao) => {
    const v = variaveis[nome];
    if (v == null || String(v).trim() === '') return padrao != null ? padrao.trim() : '';
    return String(v);
  });
}

// modelo (linha do banco ou rascunho do admin) + conteúdo dinâmico do
// produto → { assunto, layout } pronto pro email-layout.
function aplicarModelo(modelo, { layout = {}, variaveis = {} } = {}) {
  const corpo = substituir(modelo.corpo, variaveis).trim();
  const out = {
    tipo: modelo.tipo,
    titulo: substituir(modelo.titulo, variaveis).trim() || layout.titulo,
    notificacao: layout.notificacao || variaveis.notificacao,
    detalhes: layout.detalhes,
    destaque: layout.destaque,
    remetenteNome: layout.remetenteNome,
    preheader: layout.preheader,
  };
  if (corpo) out.corpoTexto = corpo;
  else if (layout.paragrafos || layout.corpoTexto) {
    out.paragrafos = layout.paragrafos;
    out.corpoTexto = layout.corpoTexto;
  }
  if (modelo.cta_texto && layout.cta && layout.cta.url) {
    out.cta = { texto: substituir(modelo.cta_texto, variaveis), url: layout.cta.url };
  }
  const motivo = substituir(modelo.motivo, variaveis).trim();
  if (motivo) out.motivo = motivo;
  return { assunto: substituir(modelo.assunto, variaveis).trim(), layout: out };
}

let cache = null;
let cacheEm = 0;

async function carregar(pool, { agora = Date.now() } = {}) {
  if (cache && agora - cacheEm < CACHE_MS) return cache;
  const novo = { modelos: new Map(), config: { ...CONFIG_PADRAO } };
  if (pool) {
    try {
      const { rows } = await pool.query('SELECT * FROM email_modelos WHERE ativo');
      for (const m of rows) novo.modelos.set(`${m.produto}:${m.chave}`, m);
      const cfg = await pool.query('SELECT chave, valor FROM email_configuracoes');
      for (const c of cfg.rows) novo.config[c.chave] = c.valor;
    } catch (err) {
      // Sem as tabelas (ou banco fora), segue com o conteúdo do produto e o
      // rodapé padrão — e-mail não pode parar por causa de texto editável.
      console.error(`[email-modelos] Falha ao carregar modelos: ${err.message}`);
      if (cache) return cache;
    }
  }
  cache = novo;
  cacheEm = agora;
  return cache;
}

function limparCache() {
  cache = null;
  cacheEm = 0;
}

module.exports = { substituir, aplicarModelo, carregar, limparCache, CONFIG_PADRAO };
