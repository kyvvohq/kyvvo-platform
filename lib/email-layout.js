// Layout único dos e-mails Kyvvo (identidade do Design System), aplicado
// pela plataforma — o produto manda só o CONTEÚDO (tipo, título, detalhes,
// botão) e o layout garante a mesma cara, o selo do produto e o rodapé
// padrão (como desativar + "não precisa responder") em todos os e-mails.
//
// E-mail não aceita CSS externo nem variável CSS: os valores abaixo são os
// tokens do tema CLARO de @kyvvohq/design-system (tokens.css), copiados e
// aplicados inline. Mudou o token lá → atualizar aqui.
// Logo em texto/HTML (não SVG — Gmail/Outlook não renderizam SVG).

const DS = {
  bg: '#F8F9FC',
  card: '#FFFFFF',
  surfaceMuted: '#F1F3F8',
  border: '#E7EAF2',
  text: '#0F111A',
  textSecondary: '#2B3040',
  muted: '#6B7385',
  textFaint: '#8A90A0',
  accent: '#7C5CFC',
  accentStrong: '#4E33C4',
  accentTint: '#F1EEFF',
  cyan: '#22C7F2',
  warningText: '#B54708',
  warningBg: '#FEF0DC',
  fontDisplay: "'Space Grotesk', Arial, Helvetica, sans-serif",
  fontUi: "'Inter', Arial, Helvetica, sans-serif",
};

const PRODUTOS = {
  studio: { nome: 'Studio', url: 'https://studio.kyvvo.com.br' },
  people: { nome: 'People', url: 'https://people.kyvvo.com.br' },
  crm: { nome: 'CRM', url: 'https://crm.kyvvo.com.br' },
  admin: { nome: 'Admin', url: 'https://admin.kyvvo.com.br' },
  platform: { nome: null, url: 'https://kyvvo.com.br' },
};

const { CONFIG_PADRAO, substituir } = require('./email-modelos');

// Onde o cliente desativa as notificações por e-mail em cada produto — vem
// de email_configuracoes (editável no admin), com o padrão do código.
function caminhoNotificacoes(produto, config) {
  const texto = config[`caminho_notificacoes_${produto}`];
  if (!texto) return null;
  return { texto, url: config[`caminho_notificacoes_${produto}_url`] || null };
}

const TIPOS = {
  notificacao: 'Notificação',
  seguranca: 'Segurança da conta',
  convite: 'Convite',
  mensagem: 'Mensagem',
  aviso: 'Aviso',
};

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function urlSegura(url) {
  return /^https:\/\//i.test(String(url || '')) ? String(url) : null;
}

// Texto livre (ex.: corpo de automação escrito pelo cliente) → HTML seguro:
// escapa, linkifica URLs https cruas e mantém as quebras de linha.
function textoParaHtml(texto) {
  return esc(texto)
    .replace(/(https:\/\/[^\s<]+)/g, `<a href="$1" style="color:${DS.accent};text-decoration:underline">$1</a>`)
    .replace(/\r?\n/g, '<br>');
}

function validarLayout(l) {
  if (!l || typeof l !== 'object') return 'layout inválido';
  if (!TIPOS[l.tipo]) return `layout.tipo inválido (use: ${Object.keys(TIPOS).join(', ')})`;
  if (!l.titulo || !String(l.titulo).trim()) return 'layout.titulo obrigatório';
  // cta com link não-https (ou sem texto) não derruba o e-mail: o botão só
  // não é desenhado (ver `cta` em renderizarEmail).
  if (l.paragrafos && !Array.isArray(l.paragrafos)) return 'layout.paragrafos deve ser lista';
  if (l.detalhes && !Array.isArray(l.detalhes)) return 'layout.detalhes deve ser lista';
  return null;
}

// Monta o rodapé: por que recebeu + como desativar (notificação) + não
// responda. Devolve { html: [linhas], texto: [linhas] }.
function montarRodape(produto, l, config) {
  const p = PRODUTOS[produto] || PRODUTOS.platform;
  const linhas = [];
  const link = (url, texto) => (urlSegura(url)
    ? `<a href="${esc(url)}" style="color:${DS.muted};text-decoration:underline"><strong>${esc(texto)}</strong></a>`
    : `<strong>${esc(texto)}</strong>`);
  if (l.tipo === 'notificacao') {
    const t = substituir(config.rodape_notificacao, { notificacao: l.notificacao || 'deste tipo' });
    linhas.push({ html: esc(t), texto: t });
    const caminho = caminhoNotificacoes(produto, config);
    if (caminho) {
      const marcador = '@@caminho@@';
      const base = substituir(config.rodape_desativar, { caminho: marcador });
      const [antes, depois = ''] = base.split(marcador);
      linhas.push({
        html: `${esc(antes)}${link(caminho.url, caminho.texto)}${esc(depois)}`,
        texto: `${antes}${caminho.texto}${caminho.url ? ` (${caminho.url})` : ''}${depois}`,
      });
    }
  } else if (l.motivo) {
    linhas.push({ html: esc(l.motivo), texto: String(l.motivo) });
  }
  const naoResponda = config.rodape_nao_responda;
  if (naoResponda) linhas.push({ html: esc(naoResponda), texto: naoResponda });
  const assinatura = p.nome ? `Kyvvo ${p.nome}` : 'Kyvvo';
  linhas.push({
    html: `${esc(assinatura)} · <a href="https://kyvvo.com.br" style="color:${DS.textFaint};text-decoration:none">kyvvo.com.br</a>`,
    texto: `${assinatura} · kyvvo.com.br`,
  });
  return linhas;
}

// layout: {
//   tipo: 'notificacao'|'seguranca'|'convite'|'mensagem'|'aviso',
//   titulo, preheader?, saudacao?, paragrafos?: [texto], corpoTexto?: texto livre,
//   detalhes?: [{ rotulo, valor }], destaque?: texto grande (ex.: código),
//   cta?: { texto, url }, notificacao?: nome do alerta (tipo notificacao),
//   motivo?: por que recebeu (demais tipos), remetenteNome?: "em nome de"
// }
// Devolve { html, text }.
function renderizarEmail(produto, l, config = CONFIG_PADRAO) {
  const p = PRODUTOS[produto] || PRODUTOS.platform;
  const rotuloTipo = TIPOS[l.tipo];
  const preheader = l.preheader || (l.paragrafos && l.paragrafos[0]) || l.corpoTexto || l.titulo;
  const cta = l.cta && l.cta.texto && urlSegura(l.cta.url) ? l.cta : null;
  const rodape = montarRodape(produto, l, { ...CONFIG_PADRAO, ...config });
  const txt = [];

  const blocos = [];
  const seloProduto = p.nome
    ? `<td style="padding-left:10px;vertical-align:middle"><span style="display:inline-block;padding:3px 10px;border:1px solid ${DS.border};border-radius:999px;font-family:${DS.fontUi};font-size:12px;font-weight:600;color:${DS.textSecondary}">${esc(p.nome)}</span></td>`
    : '';

  // Etiqueta do tipo + "em nome de"
  blocos.push(`<p style="margin:0 0 12px"><span style="display:inline-block;padding:4px 10px;background:${DS.accentTint};border-radius:999px;font-family:${DS.fontUi};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${DS.accentStrong}">${esc(rotuloTipo)}${p.nome ? ` · ${esc(p.nome)}` : ''}</span></p>`);
  txt.push(`[${rotuloTipo}${p.nome ? ` · Kyvvo ${p.nome}` : ' · Kyvvo'}]`, '');

  blocos.push(`<h1 style="margin:0 0 16px;font-family:${DS.fontDisplay};font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.01em;color:${DS.text}">${esc(l.titulo)}</h1>`);
  txt.push(String(l.titulo), '');

  const estiloP = `margin:0 0 14px;font-family:${DS.fontUi};font-size:15px;line-height:1.6;color:${DS.textSecondary}`;
  if (l.saudacao) {
    blocos.push(`<p style="${estiloP}">${esc(l.saudacao)}</p>`);
    txt.push(String(l.saudacao), '');
  }
  for (const par of l.paragrafos || []) {
    blocos.push(`<p style="${estiloP}">${esc(par)}</p>`);
    txt.push(String(par), '');
  }
  if (l.corpoTexto) {
    blocos.push(`<p style="${estiloP}">${textoParaHtml(l.corpoTexto)}</p>`);
    txt.push(String(l.corpoTexto), '');
  }

  if (l.destaque) {
    blocos.push(`<p style="margin:8px 0 20px;padding:18px;background:${DS.surfaceMuted};border-radius:12px;text-align:center;font-family:${DS.fontDisplay};font-size:32px;font-weight:700;letter-spacing:8px;color:${DS.accent}">${esc(l.destaque)}</p>`);
    txt.push(String(l.destaque), '');
  }

  if (l.detalhes && l.detalhes.length) {
    const linhas = l.detalhes
      .filter((d) => d && d.rotulo && d.valor != null && String(d.valor) !== '')
      .map((d, i) => `<tr><td style="padding:10px 14px;${i ? `border-top:1px solid ${DS.border};` : ''}font-family:${DS.fontUi};font-size:13px;color:${DS.muted};width:38%;vertical-align:top">${esc(d.rotulo)}</td><td style="padding:10px 14px;${i ? `border-top:1px solid ${DS.border};` : ''}font-family:${DS.fontUi};font-size:14px;font-weight:600;color:${DS.text};vertical-align:top">${esc(d.valor)}</td></tr>`);
    if (linhas.length) {
      blocos.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border:1px solid ${DS.border};border-radius:12px;border-collapse:separate">${linhas.join('')}</table>`);
      for (const d of l.detalhes) if (d && d.rotulo && d.valor != null && String(d.valor) !== '') txt.push(`${d.rotulo}: ${d.valor}`);
      txt.push('');
    }
  }

  if (cta) {
    blocos.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="background:${DS.accent};border-radius:10px"><a href="${esc(cta.url)}" style="display:inline-block;padding:13px 24px;font-family:${DS.fontUi};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none">${esc(cta.texto)}</a></td></tr></table>`);
    txt.push(`${cta.texto}: ${cta.url}`, '');
  }

  if (l.remetenteNome) {
    blocos.push(`<p style="margin:20px 0 0;font-family:${DS.fontUi};font-size:13px;line-height:1.5;color:${DS.muted}">Enviado por <strong>${esc(l.remetenteNome)}</strong> pelo Kyvvo${p.nome ? ` ${esc(p.nome)}` : ''}.</p>`);
    txt.push(`Enviado por ${l.remetenteNome} pelo Kyvvo${p.nome ? ` ${p.nome}` : ''}.`, '');
  }

  txt.push('—');
  for (const r of rodape) txt.push(r.texto);

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(l.titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${DS.bg}">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${esc(String(preheader).slice(0, 140))}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${DS.bg}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="32" height="32" align="center" style="width:32px;height:32px;background:${DS.accent};border-radius:8px;font-family:${DS.fontDisplay};font-size:15px;font-weight:700;color:#FFFFFF;line-height:32px">vv</td></tr></table></td>
<td style="padding-left:10px;vertical-align:middle;font-family:${DS.fontDisplay};font-size:22px;font-weight:700;letter-spacing:-.03em;color:${DS.text}">ky<span style="color:${DS.accent}">vv</span>o</td>
${seloProduto}
</tr></table>
</td></tr>
<tr><td style="background:${DS.card};border:1px solid ${DS.border};border-radius:16px;overflow:hidden">
<div style="height:4px;line-height:4px;font-size:0;background:${DS.accent};background-image:linear-gradient(90deg,${DS.accent},${DS.cyan})">&nbsp;</div>
<div style="padding:32px">
${blocos.join('\n')}
</div>
</td></tr>
<tr><td style="padding:20px 8px 0;font-family:${DS.fontUi};font-size:12px;line-height:1.6;color:${DS.muted}">
${rodape.map((r) => `<p style="margin:0 0 6px">${r.html}</p>`).join('\n')}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { html, text: txt.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

module.exports = { renderizarEmail, validarLayout, textoParaHtml, PRODUTOS, TIPOS, DS };
