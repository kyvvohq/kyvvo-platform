require('dotenv').config();

const Fastify = require('fastify');

const { pool, migrar } = require('./lib/db');
const tokenService = require('./token-service');
const configSistema = require('./lib/configuracoes-sistema');
const eventos = require('./lib/eventos');
const planos = require('./lib/planos');
const { registrarGuards } = require('./lib/auth-guards');
const { registerAuthRoutes } = require('./routes/auth');
const { registerEntitlementsRoutes } = require('./routes/entitlements');
const { registerPagamentosRoutes } = require('./routes/pagamentos');
const { registerWebhookWhatsappRoutes } = require('./routes/webhook-whatsapp');
const jwtRs256 = require('./lib/jwt-rs256');

const PORT = process.env.PORT || 3003;

function build() {
  const fastify = Fastify({ logger: true });

  // Mesmo padrão `init(pool)` do painel — os módulos compartilham o pool do
  // processo em vez de abrir conexão própria.
  tokenService.init(pool);
  configSistema.init(pool);
  eventos.init(pool);
  planos.init(pool);

  registrarGuards(fastify, pool);
  registerEntitlementsRoutes(fastify, pool);
  registerAuthRoutes(fastify, pool);
  registerPagamentosRoutes(fastify, pool);
  registerWebhookWhatsappRoutes(fastify);

  return fastify;
}

async function start() {
  const fastify = build();

  try {
    await migrar();
  } catch (err) {
    fastify.log.error({ err }, 'falha ao aplicar migrations — abortando boot');
    await pool.end().catch(() => {});
    process.exit(1);
  }

  await configSistema.carregar().catch((err) => {
    fastify.log.warn({ err }, 'não foi possível carregar configuracoes_sistema — usando defaults em memória');
  });

  await planos.carregar().catch((err) => {
    fastify.log.warn({ err }, 'não foi possível carregar o catálogo de planos');
  });

  if (jwtRs256.efemera) {
    fastify.log.warn('JWT assinado com par RSA efêmero (chaves não configuradas)');
  }

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
}

if (require.main === module) {
  start();
}

module.exports = { build, start };
