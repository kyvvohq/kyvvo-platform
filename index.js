require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');

const { pool, migrar } = require('./lib/db');
const tokenService = require('./token-service');
const email = require('./lib/email');
const configSistema = require('./lib/configuracoes-sistema');
const eventos = require('./lib/eventos');
const planos = require('./lib/planos');
const { registrarGuards } = require('./lib/auth-guards');
const { registrarGuardsAdmin } = require('./lib/admin-rbac');
const { registerAuthRoutes } = require('./routes/auth');
const { registerEntitlementsRoutes } = require('./routes/entitlements');
const { registerHandoffRoutes } = require('./routes/handoff');
const { registerPagamentosRoutes } = require('./routes/pagamentos');
const { registerWebhookWhatsappRoutes } = require('./routes/webhook-whatsapp');
const { registerEmailRoutes } = require('./routes/email');
const { registerAdminAuthRoutes } = require('./routes/admin/auth');
const { registerAdminClientesRoutes } = require('./routes/admin/clientes');
const { registerAdminUsuariosRoutes } = require('./routes/admin/usuarios');
const { registerAdminSearchRoutes } = require('./routes/admin/search');
const { registerAdminProdutosRoutes } = require('./routes/admin/produtos');
const { registerAdminPlataformaRoutes } = require('./routes/admin/plataforma');
const { registerAdminWhatsappRoutes } = require('./routes/admin/whatsapp');
const { registerAdminTemplatesRoutes } = require('./routes/admin/templates');
const { registerAdminVisaoGeralRoutes } = require('./routes/admin/visao-geral');
const { registerAdminSistemaRoutes } = require('./routes/admin/sistema');
const { registerAdminSistemaAdminsRoutes } = require('./routes/admin/sistema-admins');
const { registerAdminSistemaConfigRoutes } = require('./routes/admin/sistema-config');
const { registerAdminNumerosProntosRoutes } = require('./routes/admin/numeros-prontos');
const jwtRs256 = require('./lib/jwt-rs256');

const PORT = process.env.PORT || 3003;

function build() {
  const fastify = Fastify({ logger: true });

  // Mesmo padrão `init(pool)` do painel — os módulos compartilham o pool do
  // processo em vez de abrir conexão própria.
  tokenService.init(pool);
  email.init(pool);
  configSistema.init(pool);
  eventos.init(pool);
  planos.init(pool);

  registrarGuards(fastify, pool);
  registrarGuardsAdmin(fastify, pool);
  registerEntitlementsRoutes(fastify, pool);
  registerHandoffRoutes(fastify);
  registerAuthRoutes(fastify, pool);
  registerPagamentosRoutes(fastify, pool);
  registerWebhookWhatsappRoutes(fastify, pool);
  registerEmailRoutes(fastify, pool);
  registerAdminAuthRoutes(fastify, pool);
  registerAdminClientesRoutes(fastify, pool);
  registerAdminUsuariosRoutes(fastify, pool);
  registerAdminSearchRoutes(fastify, pool);
  registerAdminProdutosRoutes(fastify, pool);
  registerAdminPlataformaRoutes(fastify, pool);
  registerAdminWhatsappRoutes(fastify, pool);
  registerAdminTemplatesRoutes(fastify, pool);
  registerAdminVisaoGeralRoutes(fastify, pool);
  registerAdminSistemaRoutes(fastify, pool);
  registerAdminSistemaAdminsRoutes(fastify, pool);
  registerAdminSistemaConfigRoutes(fastify, pool);
  registerAdminNumerosProntosRoutes(fastify, pool);

  // Estáticos: /ds/ (Design System, mesmo padrão do Studio) e /admin/ (a SPA
  // buildada). @fastify/static só decora reply.sendFile uma vez — as demais
  // registrações passam decorateReply:false.
  let staticDecorado = false;
  const registrarEstatico = (opts) => {
    fastify.register(fastifyStatic, { ...opts, decorateReply: !staticDecorado });
    staticDecorado = true;
  };

  // @kyvvohq/design-system: a SPA referencia /ds/tokens.css etc.
  const dsRoot = path.join(__dirname, 'node_modules', '@kyvvohq', 'design-system');
  if (fs.existsSync(dsRoot)) {
    registrarEstatico({ root: dsRoot, prefix: '/ds/' });
  }

  // Portal admin (SPA Vite/React) servido estático em /admin. O build vai pra
  // admin/dist no deploy (não versionado; ver admin/README.md). Enquanto o
  // build não existe — CI, dev sem build — nada disto sobe e o serviço segue
  // sendo só a API.
  const adminDist = path.join(__dirname, 'admin', 'dist');
  if (fs.existsSync(path.join(adminDist, 'index.html'))) {
    registrarEstatico({ root: adminDist, prefix: '/admin/', wildcard: false });

    fastify.setNotFoundHandler((request, reply) => {
      // Fallback de SPA: GET em /admin/* que não seja arquivo real nem
      // /admin/api/* devolve o index.html pro roteamento client-side.
      if (
        request.method === 'GET' &&
        request.url.startsWith('/admin') &&
        !request.url.startsWith('/admin/api')
      ) {
        return reply.type('text/html').sendFile('index.html', adminDist);
      }
      return reply
        .code(404)
        .send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: 404 });
    });
  }

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
