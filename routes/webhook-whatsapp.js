// Webhook único do WhatsApp pra Kyvvo inteira — a Meta só permite UMA URL
// de callback por App, e o App é um só pra todos os produtos (Studio +
// People). Antes disso, a URL cadastrada apontava direto pro webhook do
// Studio (via app.kyvvo.com.br, que hoje é 301 permanente pra
// studio.kyvvo.com.br — POST em redirect é frágil, foi o mesmo tipo de bug
// que já quebrou o login do People nesta sessão). Achado 2026-09-09: se um
// segundo produto (People) também precisasse de webhook, registrar a URL
// dele substituiria a do Studio — não dá pra ter duas.
//
// Solução: o platform vira o ÚNICO destino cadastrado na Meta
// (https://auth.kyvvo.com.br/webhook/whatsapp) e reencaminha pro produto
// certo por `phone_number_id` — People tem um número fixo só (env var),
// qualquer outro cai no Studio (N números, um por tenant, ele mesmo resolve
// qual via `tenants.meta_phone_number_id`). Encaminha pro HOST REAL de cada
// produto (nunca via app.kyvvo.com.br) — não reproduz o redirect frágil.
//
// Cada produto continua com seu próprio handler de POST (não migrado pra
// cá) — o platform só decide PRA QUEM encaminhar, nunca processa a
// mensagem. `X-Webhook-Internal-Secret` autentica o encaminhamento (o
// endpoint de cada produto deixa de ser aberto pra Meta direto).
const { produtoDoToken } = require('./email');

// Extrai o phone_number_id do payload de webhook da Meta — undefined se o
// evento não tiver mensagem (ex.: status "delivered"/"read"), mesmo shape
// que o kyvvo-studio já usa (routes/webhook-whatsapp.js).
function extrairPhoneNumberId(body) {
  const change = (((body && body.entry) || [])[0] || {}).changes || [];
  const value = change[0] && change[0].value;
  return value && value.metadata && value.metadata.phone_number_id;
}

// Pura — separada do handler pra testar sem subir o Fastify. `env` é
// process.env por padrão, injetável pra teste sem mexer no processo real.
// CRM (2026-09-24): número dedicado ao bot da Basic 3D Print — mesmo
// raciocínio do People (produto com número(s) fixo(s) fora do pool de
// tenants do Studio), checado antes do fallback pro Studio.
// Kyvvo Atendimento (2026-10-21): número próprio da Kyvvo (não é tenant de
// ninguém) — mensagens vão direto pro workflow n8n novo e isolado "Kyvvo —
// Atendimento Geral/Suporte/Vendas" (nunca o v4/Bot Lucas), que lê/grava
// direto nas tabelas do kyvvo-crm (crm_leads/crm_chamados/crm_clientes).
function decidirDestino(phoneNumberId, env = process.env) {
  if (phoneNumberId && env.PEOPLE_PHONE_NUMBER_ID && phoneNumberId === env.PEOPLE_PHONE_NUMBER_ID) {
    return env.PEOPLE_WEBHOOK_URL || null;
  }
  if (phoneNumberId && env.CRM_PHONE_NUMBER_ID && phoneNumberId === env.CRM_PHONE_NUMBER_ID) {
    return env.CRM_WEBHOOK_URL || null;
  }
  if (phoneNumberId && env.KYVVO_ATENDIMENTO_PHONE_NUMBER_ID && phoneNumberId === env.KYVVO_ATENDIMENTO_PHONE_NUMBER_ID) {
    return env.KYVVO_ATENDIMENTO_WEBHOOK_URL || null;
  }
  return env.STUDIO_WEBHOOK_URL || null;
}

// Classifica o evento pelo shape do payload da Meta (mesmo `value` do
// extrairPhoneNumberId). `mensagem` = tem `messages[]`; `status` = tem
// `statuses[]` (delivered/read/failed); senão `outro`.
function classificarEvento(body) {
  const change = (((body && body.entry) || [])[0] || {}).changes || [];
  const value = (change[0] && change[0].value) || {};
  if (Array.isArray(value.messages) && value.messages.length) return { tipo: 'mensagem', value };
  if (Array.isArray(value.statuses) && value.statuses.length) return { tipo: 'status', value };
  return { tipo: 'outro', value };
}

// Best-effort: registra o evento (e os status de mensagem, se houver) pro
// admin poder auditar entregas/erros. Nunca bloqueia o 200 pra Meta.
async function persistirEvento(pool, body, { phoneNumberId, destino }) {
  const { tipo, value } = classificarEvento(body);
  await pool.query(
    `INSERT INTO whatsapp_webhook_events (phone_number_id, tipo, destino, encaminhado, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [phoneNumberId || null, tipo, destino || null, !!destino, JSON.stringify(body)],
  );
  if (tipo === 'status') {
    for (const s of value.statuses) {
      const erro = (s.errors || [])[0] || {};
      await pool.query(
        `INSERT INTO whatsapp_message_status (message_id, phone_number_id, status, erro_codigo, erro_titulo, ts)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
         ON CONFLICT (message_id, status) DO NOTHING`,
        [
          s.id,
          phoneNumberId || null,
          s.status,
          erro.code != null ? String(erro.code) : null,
          erro.title || null,
          Number(s.timestamp) || Math.floor(Date.now() / 1000),
        ],
      );
    }
  }
}

function registerWebhookWhatsappRoutes(fastify, pool) {
  // Diagnóstico pro portal admin (achado ao vivo, 2026-10-13: bot da Basic
  // 3D Print sem responder, sem nenhuma pista de onde a mensagem parava —
  // nenhuma tela mostrava se um evento da Meta sequer chegou aqui, nem pra
  // onde foi encaminhado). Reaproveita o mesmo token admin já usado por
  // /internal/email/preview (routes/email.js) — nenhum segredo novo.
  fastify.get('/internal/whatsapp/eventos', async (request, reply) => {
    if (produtoDoToken(request.headers['x-internal-token']) !== 'admin') {
      return reply.code(401).send({ error: 'Não autorizado' });
    }
    if (!pool) return reply.code(503).send({ error: 'Banco indisponível' });
    const { pnid } = request.query || {};
    const limit = Math.min(Math.max(parseInt(request.query.limit, 10) || 20, 1), 100);
    const params = [];
    let where = '';
    if (pnid) {
      params.push(pnid);
      where = 'WHERE phone_number_id = $1';
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, phone_number_id, tipo, destino, encaminhado, recebido_em
         FROM whatsapp_webhook_events
         ${where}
        ORDER BY recebido_em DESC
        LIMIT $${params.length}`,
      params,
    );
    return { eventos: rows };
  });

  fastify.get('/webhook/whatsapp', async (request, reply) => {
    const query = request.query || {};
    const valido = query['hub.mode'] === 'subscribe'
      && !!process.env.META_VERIFY_TOKEN
      && query['hub.verify_token'] === process.env.META_VERIFY_TOKEN;
    if (!valido) return reply.code(403).send('Forbidden');
    return reply.code(200).type('text/plain').send(query['hub.challenge'] || '');
  });

  fastify.post('/webhook/whatsapp', async (request, reply) => {
    try {
      const body = request.body || {};
      const phoneNumberId = extrairPhoneNumberId(body);
      const destino = decidirDestino(phoneNumberId);

      if (pool) {
        persistirEvento(pool, body, { phoneNumberId, destino }).catch((err) =>
          fastify.log.error({ err: err.message }, '[webhook-whatsapp] Falha ao persistir evento'),
        );
      }

      if (destino) {
        // Best-effort, sem esperar a resposta do produto influenciar o que a
        // Meta recebe — a Meta só precisa de um 200 rápido, e um produto
        // fora do ar não pode fazer a Meta desativar o webhook por timeout.
        fetch(destino, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Internal-Secret': process.env.WEBHOOK_INTERNAL_SECRET || '' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        }).catch((err) => fastify.log.error({ err: err.message, destino }, '[webhook-whatsapp] Falha ao encaminhar'));
      } else {
        fastify.log.warn({ phoneNumberId }, '[webhook-whatsapp] phone_number_id sem destino configurado — evento descartado');
      }
    } catch (err) {
      fastify.log.error({ err: err.message }, '[webhook-whatsapp] Falha ao rotear');
    }
    return reply.code(200).send({ ok: true });
  });
}

module.exports = {
  registerWebhookWhatsappRoutes,
  decidirDestino,
  extrairPhoneNumberId,
  classificarEvento,
};
