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
function decidirDestino(phoneNumberId, env = process.env) {
  if (phoneNumberId && env.PEOPLE_PHONE_NUMBER_ID && phoneNumberId === env.PEOPLE_PHONE_NUMBER_ID) {
    return env.PEOPLE_WEBHOOK_URL || null;
  }
  return env.STUDIO_WEBHOOK_URL || null;
}

function registerWebhookWhatsappRoutes(fastify) {
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

module.exports = { registerWebhookWhatsappRoutes, decidirDestino, extrairPhoneNumberId };
