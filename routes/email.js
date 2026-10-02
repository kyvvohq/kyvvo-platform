// Serviço de e-mail da plataforma, consumido por todos os produtos.
//
// POST /internal/email/send — produtos (Studio, People, CRM, admin) mandam
// e-mail por aqui. Autenticação por token interno POR PRODUTO
// (INTERNAL_EMAIL_TOKENS="studio:xxx,people:yyy,crm:zzz"): o produto é
// deduzido do token, não do corpo — um produto não consegue se passar por
// outro nos logs nem usar o remetente de outro.
//
// POST /webhook/ses — eventos do SES (configuration set → tópico SNS →
// assinatura HTTPS aqui). Bounce permanente e reclamação entram na lista de
// supressão; entrega/bounce/reclamação atualizam o status em email_envios.

const crypto = require('crypto');
const email = require('../lib/email');
const emailLayout = require('../lib/email-layout');
const emailModelos = require('../lib/email-modelos');
const sns = require('../lib/sns');

// "studio:abc,people:def" -> Map(token -> produto)
function lerTokensProdutos(valor) {
  const mapa = new Map();
  String(valor || '').split(',').forEach((par) => {
    const i = par.indexOf(':');
    if (i <= 0) return;
    const produto = par.slice(0, i).trim().toLowerCase();
    const token = par.slice(i + 1).trim();
    if (produto && token) mapa.set(token, produto);
  });
  return mapa;
}

function iguaisTempoConstante(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function produtoDoToken(headerRecebido, env = process.env) {
  if (!headerRecebido) return null;
  for (const [token, produto] of lerTokensProdutos(env.INTERNAL_EMAIL_TOKENS)) {
    if (iguaisTempoConstante(headerRecebido, token)) return produto;
  }
  return null;
}

// Converte um evento do SES (formato de configuration set — `eventType` — ou
// o de notificação de identidade — `notificationType`) em ações:
// { messageId, status, supressoes: [{ email, motivo, detalhe }] }.
function interpretarEventoSes(evento) {
  const tipo = (evento && (evento.eventType || evento.notificationType)) || '';
  const messageId = evento && evento.mail && evento.mail.messageId;
  const out = { tipo, messageId, status: null, supressoes: [] };

  if (tipo === 'Delivery') {
    out.status = 'entregue';
  } else if (tipo === 'Bounce') {
    const b = evento.bounce || {};
    out.status = 'bounce';
    if (b.bounceType === 'Permanent') {
      out.supressoes = (b.bouncedRecipients || []).map((r) => ({
        email: email.normalizarEmail(r.emailAddress),
        motivo: 'bounce',
        detalhe: [b.bounceSubType, r.diagnosticCode].filter(Boolean).join(' — ').slice(0, 500),
      }));
    }
  } else if (tipo === 'Complaint') {
    const c = evento.complaint || {};
    out.status = 'reclamacao';
    out.supressoes = (c.complainedRecipients || []).map((r) => ({
      email: email.normalizarEmail(r.emailAddress),
      motivo: 'reclamacao',
      detalhe: (c.complaintFeedbackType || '').slice(0, 500) || null,
    }));
  } else if (tipo === 'Reject') {
    out.status = 'rejeitado';
  }
  return out;
}

async function aplicarEvento(pool, acao) {
  if (acao.messageId && acao.status) {
    // Não rebaixa um bounce/reclamação de volta pra 'entregue' se os eventos
    // chegarem fora de ordem.
    await pool.query(
      `UPDATE email_envios SET status = $2, atualizado_em = now()
        WHERE message_id = $1 AND status NOT IN ('bounce', 'reclamacao')`,
      [acao.messageId, acao.status],
    );
  }
  for (const s of acao.supressoes) {
    if (!s.email) continue;
    await pool.query(
      `INSERT INTO email_supressoes (email, motivo, detalhe) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [s.email, s.motivo, s.detalhe || null],
    );
  }
}

function registerEmailRoutes(fastify, pool, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;

  fastify.post('/internal/email/send', async (request, reply) => {
    const produto = produtoDoToken(request.headers['x-internal-token']);
    if (!produto) return reply.code(401).send({ error: 'Não autenticado' });

    const b = request.body || {};
    const resultado = await email.enviar({
      produto,
      to: b.to,
      subject: b.subject,
      html: b.html,
      text: b.text,
      replyTo: b.replyTo,
      fromName: b.fromName,
      tag: b.tag,
      layout: b.layout,
      modelo: b.modelo,
      variaveis: b.variaveis,
      // Só o admin manda em nome de outro produto (botão "enviar teste" de
      // um modelo do Studio/People/CRM).
      produtoModelo: produto === 'admin' ? b.produto : undefined,
    });
    if (resultado.erro) return reply.code(400).send({ error: resultado.erro });
    return reply.code(resultado.ok ? 200 : 502).send(resultado);
  });

  // Prévia pro editor do admin: renderiza um modelo (rascunho ainda não
  // salvo, vindo no corpo) com as variáveis de exemplo. Só token do admin.
  fastify.post('/internal/email/preview', async (request, reply) => {
    if (produtoDoToken(request.headers['x-internal-token']) !== 'admin') {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
    const b = request.body || {};
    const produtoAlvo = b.produto || 'platform';
    if (!emailLayout.PRODUTOS[produtoAlvo]) return reply.code(400).send({ error: 'produto inválido' });
    if (!b.modelo || typeof b.modelo !== 'object') return reply.code(400).send({ error: 'modelo obrigatório' });
    const dados = await emailModelos.carregar(pool);
    const config = { ...dados.config, ...(b.config || {}) };
    const { assunto, layout } = emailModelos.aplicarModelo(b.modelo, { layout: b.layout || {}, variaveis: b.variaveis || {} });
    const erro = emailLayout.validarLayout(layout);
    if (erro) return reply.code(400).send({ error: erro });
    const r = emailLayout.renderizarEmail(produtoAlvo, layout, config);
    return { assunto, html: r.html, text: r.text };
  });

  fastify.post('/webhook/ses', async (request, reply) => {
    let msg = request.body;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch { return reply.code(400).send({ error: 'JSON inválido' }); }
    }
    if (!(await sns.assinaturaValida(msg, { fetchImpl }))) {
      return reply.code(403).send({ error: 'Assinatura inválida' });
    }
    const topicoEsperado = process.env.SES_SNS_TOPIC_ARN;
    if (!topicoEsperado || msg.TopicArn !== topicoEsperado) {
      fastify.log.warn({ topic: msg.TopicArn }, '[webhook-ses] tópico não reconhecido');
      return reply.code(403).send({ error: 'Tópico não reconhecido' });
    }

    if (msg.Type === 'SubscriptionConfirmation') {
      if (!sns.urlSnsValida(msg.SubscribeURL)) return reply.code(400).send({ error: 'SubscribeURL inválida' });
      const res = await fetchImpl(msg.SubscribeURL, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      fastify.log.info({ ok: !!(res && res.ok) }, '[webhook-ses] assinatura SNS confirmada');
      return { ok: !!(res && res.ok) };
    }

    if (msg.Type === 'Notification') {
      try {
        const acao = interpretarEventoSes(JSON.parse(msg.Message));
        if (pool) await aplicarEvento(pool, acao);
      } catch (err) {
        fastify.log.error({ err: err.message }, '[webhook-ses] falha ao processar evento');
      }
    }
    return { ok: true };
  });
}

module.exports = {
  registerEmailRoutes,
  lerTokensProdutos,
  produtoDoToken,
  interpretarEventoSes,
};
