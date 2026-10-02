// Envio de e-mail da plataforma — o único ponto da Kyvvo que fala com o
// provedor de e-mail. Os produtos chamam POST /internal/email/send (ver
// routes/email.js); o próprio platform (token-service.js) chama `enviar`
// direto.
//
// Provedor escolhido por EMAIL_PROVIDER:
//   - 'ses'    — AWS SES v2 (SendEmail). Credenciais pela cadeia padrão do
//                SDK (role da instância EC2 em produção). Região: SES_REGION
//                ou AWS_REGION, default us-east-1.
//   - 'resend' — fallback da transição (mesma chamada HTTP que os produtos
//                faziam), enquanto a conta SES não sai do sandbox.
//   - ausente  — 'resend' se RESEND_API_KEY existir, senão modo log (só
//                imprime no console, útil em dev).
//
// Antes de enviar, confere a lista de supressão (bounce permanente /
// reclamação, alimentada pelo webhook do SNS). Todo envio vira linha em
// `email_envios`. `enviar` nunca lança — devolve { ok, status, ... }.

const layout = require('./email-layout');
const modelos = require('./email-modelos');

const REMETENTE_PADRAO = 'Kyvvo <no-reply@kyvvo.com.br>';
const DOMINIOS_REMETENTE = ['kyvvo.com.br'];
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

let pool = null;
function init(sharedPool) {
  pool = sharedPool;
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function emailValido(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

// Extrai o endereço de "Nome <a@b>" ou "a@b".
function enderecoDe(remetente) {
  const m = /<([^>]+)>/.exec(String(remetente || ''));
  return normalizarEmail(m ? m[1] : remetente);
}

// O SES só envia de identidade verificada — e o DMARC do kyvvo.com.br é
// p=reject, então um From de outro domínio seria descartado pelo
// destinatário de qualquer jeito. Melhor recusar aqui com erro claro.
function remetentePermitido(remetente) {
  const endereco = enderecoDe(remetente);
  const dominio = endereco.split('@')[1] || '';
  return emailValido(endereco) && DOMINIOS_REMETENTE.includes(dominio);
}

// Monta o From: `fromName` personaliza só o nome de exibição (ex.: nome do
// salão), o endereço continua sendo o padrão do produto.
function montarRemetente({ produto, fromName, env = process.env }) {
  const chave = `EMAIL_FROM_${String(produto || '').toUpperCase()}`;
  const base = env[chave] || env.EMAIL_FROM || env.RESEND_FROM || REMETENTE_PADRAO;
  if (!fromName) return base;
  const nomeLimpo = String(fromName).replace(/["<>\r\n]/g, '').trim().slice(0, 80);
  return nomeLimpo ? `"${nomeLimpo}" <${enderecoDe(base)}>` : base;
}

function escolherProvedor(env = process.env) {
  const p = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (p === 'ses' || p === 'resend' || p === 'log') return p;
  return env.RESEND_API_KEY ? 'resend' : 'log';
}

// Valida o payload de envio — devolve a mensagem de erro ou null.
function validarMensagem({ to, subject, html, text }) {
  const lista = Array.isArray(to) ? to : [to];
  if (!lista.length || lista.some((e) => !emailValido(e))) return 'Destinatário inválido';
  if (lista.length > 50) return 'Máximo de 50 destinatários por envio';
  if (!subject || !String(subject).trim()) return 'Assunto obrigatório';
  if (String(subject).length > 300) return 'Assunto longo demais';
  if (!html && !text) return 'Corpo obrigatório (html ou text)';
  return null;
}

let sesClientCache = null;
// Lazy: o SDK só é carregado se o provedor for SES — o container tem pouca
// memória e os testes não precisam dele.
function clienteSes(env = process.env) {
  if (!sesClientCache) {
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    sesClientCache = new SESv2Client({ region: env.SES_REGION || env.AWS_REGION || 'us-east-1' });
  }
  return sesClientCache;
}

// Pura — monta o input do SendEmail (SESv2) pra testar sem o SDK.
function montarEntradaSes({ remetente, destinatario, subject, html, text, replyTo, produto, tag }, env = process.env) {
  const tags = [{ Name: 'produto', Value: produto }];
  if (tag) tags.push({ Name: 'tag', Value: String(tag).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) });
  const body = {};
  if (html) body.Html = { Data: html, Charset: 'UTF-8' };
  if (text) body.Text = { Data: text, Charset: 'UTF-8' };
  return {
    FromEmailAddress: remetente,
    Destination: { ToAddresses: [destinatario] },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: body } },
    ConfigurationSetName: env.SES_CONFIGURATION_SET || undefined,
    EmailTags: tags,
  };
}

// `sesSend(input)` injetável pra teste; em produção usa o SDK.
async function enviarSes(dados, { env, sesSend }) {
  const input = montarEntradaSes(dados, env);
  if (sesSend) return (await sesSend(input)).MessageId;
  const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const res = await clienteSes(env).send(new SendEmailCommand(input));
  return res.MessageId;
}

async function enviarResend({ remetente, destinatario, subject, html, text, replyTo }, { env, fetchImpl }) {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: remetente, to: [destinatario], subject, html, text, reply_to: replyTo || undefined,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`Resend respondeu ${res.status}: ${corpo.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => ({}));
  return json.id || null;
}

async function registrar(db, linha) {
  if (!db) return;
  try {
    await db.query(
      `INSERT INTO email_envios (produto, tag, remetente, destinatario, assunto, provedor, message_id, status, erro)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [linha.produto, linha.tag || null, linha.remetente, linha.destinatario, linha.assunto,
        linha.provedor, linha.messageId || null, linha.status, linha.erro || null],
    );
  } catch (err) {
    console.error(`[email] Falha ao registrar envio: ${err.message}`);
  }
}

async function suprimidos(db, emails) {
  if (!db || !emails.length) return new Set();
  try {
    const { rows } = await db.query('SELECT email FROM email_supressoes WHERE email = ANY($1)', [emails]);
    return new Set(rows.map((r) => r.email));
  } catch (err) {
    // Sem a tabela/conexão, não bloqueia o envio — perder um e-mail de
    // código de verificação é pior que um bounce eventual.
    console.error(`[email] Falha ao consultar supressões: ${err.message}`);
    return new Set();
  }
}

// Envia uma mensagem (um envio por destinatário — o SES cobra igual, e assim
// cada destinatário tem seu MessageId e seu status). Devolve
// { ok, resultados: [{ to, status, messageId?, erro? }] }; ok = todos
// enviados (ou logados, em dev).
async function enviar(msg, deps = {}) {
  const env = deps.env || process.env;
  const db = deps.pool === undefined ? pool : deps.pool;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const produto = msg.produto || 'platform';

  // `modelo` (chave editável no admin) + `variaveis`: os textos vêm de
  // email_modelos; o produto manda só o dinâmico em `layout`. Sem modelo
  // ativo pra chave, vale o `layout`/`subject` que o produto mandou.
  // `layout` → html/text com a identidade Kyvvo (lib/email-layout.js).
  // Sem nenhum dos dois, usa o html/text que vier pronto.
  const produtoModelo = msg.produtoModelo || produto;
  if (msg.modelo || msg.layout) {
    const dados = deps.modelos || await modelos.carregar(db);
    let estrutura = msg.layout;
    let subject = msg.subject;
    const m = msg.modelo && dados.modelos.get(`${produtoModelo}:${msg.modelo}`);
    if (m) {
      const r = modelos.aplicarModelo(m, { layout: msg.layout || {}, variaveis: msg.variaveis || {} });
      estrutura = r.layout;
      subject = r.assunto || subject;
    }
    if (estrutura) {
      const erroLayout = layout.validarLayout(estrutura);
      if (erroLayout) return { ok: false, erro: erroLayout, resultados: [] };
      const r = layout.renderizarEmail(produtoModelo, estrutura, dados.config);
      msg = { ...msg, subject, html: r.html, text: r.text, tag: msg.tag || msg.modelo };
    }
  }

  const erro = validarMensagem(msg);
  if (erro) return { ok: false, erro, resultados: [] };

  const remetente = msg.from || montarRemetente({ produto, fromName: msg.fromName, env });
  if (!remetentePermitido(remetente)) {
    return { ok: false, erro: `Remetente não permitido: ${remetente}`, resultados: [] };
  }

  const provedor = escolherProvedor(env);
  const destinatarios = [...new Set((Array.isArray(msg.to) ? msg.to : [msg.to]).map(normalizarEmail))];
  const bloqueados = await suprimidos(db, destinatarios);
  const resultados = [];

  for (const destinatario of destinatarios) {
    const base = {
      produto, tag: msg.tag, remetente, destinatario, assunto: msg.subject, provedor,
    };
    if (bloqueados.has(destinatario)) {
      await registrar(db, { ...base, status: 'suprimido' });
      resultados.push({ to: destinatario, status: 'suprimido' });
      continue;
    }
    if (provedor === 'log') {
      console.log(`[email] (dev) [${produto}] "${msg.subject}" para ${destinatario}`);
      await registrar(db, { ...base, status: 'log' });
      resultados.push({ to: destinatario, status: 'log' });
      continue;
    }
    try {
      const dados = { ...msg, remetente, destinatario, produto };
      const messageId = provedor === 'ses'
        ? await enviarSes(dados, { env, sesSend: deps.sesSend })
        : await enviarResend(dados, { env, fetchImpl });
      await registrar(db, { ...base, messageId, status: 'enviado' });
      resultados.push({ to: destinatario, status: 'enviado', messageId });
    } catch (err) {
      console.error(`[email] [${provedor}] Falha ao enviar para ${destinatario}: ${err.message}`);
      await registrar(db, { ...base, status: 'falhou', erro: err.message.slice(0, 500) });
      resultados.push({ to: destinatario, status: 'falhou', erro: err.message });
    }
  }

  const ok = resultados.every((r) => r.status === 'enviado' || r.status === 'log');
  return { ok, resultados };
}

module.exports = {
  init,
  enviar,
  validarMensagem,
  montarRemetente,
  remetentePermitido,
  escolherProvedor,
  montarEntradaSes,
  normalizarEmail,
  enderecoDe,
};
