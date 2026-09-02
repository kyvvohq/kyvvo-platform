// Leitura de entitlements + catálogo de planos + infra (health, JWKS).
//
// É a metade servidor do @kyvvohq/platform-client: os backends de Studio e
// People chamam GET /entitlements/:tenantId (encaminhando o JWT do usuário)
// pra decidir o que liberar, e GET /plans pra montar a página de preços.
//
// NOTA (reconciliar na leva de corte): o shape de GET /plans aqui é um
// superset do que kyvvo/server/panel/routes/publico.js#GET /api/planos
// devolve hoje. Quando o Studio passar a consumir isto, alinhar campo a campo.

const jwtRs256 = require('../lib/jwt-rs256');
const { calcularBloqueioAssinatura } = require('../lib/trial-conta');

function registerEntitlementsRoutes(fastify, pool) {
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  fastify.get('/.well-known/jwks.json', async (request, reply) => {
    // Cacheável: a chave só muda numa rotação (e aí o kid muda junto).
    reply.header('Cache-Control', 'public, max-age=3600');
    return jwtRs256.jwks();
  });

  // Entitlements do tenant logado. Como GET /api/auth/people/acesso, exige um
  // JWT da plataforma e só devolve os dados do próprio tenant do token — um
  // produto encaminha o Authorization do request que está atendendo.
  fastify.get(
    '/entitlements/:tenantId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.params;
      if (tenantId !== request.user.tenantId) {
        return reply.code(403).send({ error: 'Sem acesso a este tenant.' });
      }

      const { rows: tenantRows } = await pool.query(
        `SELECT plano, status, ativado_em, status_alterado_em, acesso_ate
         FROM tenants WHERE id = $1`,
        [tenantId]
      );
      const tenant = tenantRows[0];
      if (!tenant) {
        return reply.code(404).send({ error: 'Tenant não encontrado' });
      }

      const { rows: modRows } = await pool.query(
        'SELECT modulo_key FROM tenant_modulos WHERE tenant_id = $1 AND ativo ORDER BY modulo_key',
        [tenantId]
      );

      const { rows: limiteRows } = tenant.plano
        ? await pool.query(
            'SELECT chave, valor, unidade FROM plano_limites WHERE plano_chave = $1',
            [tenant.plano]
          )
        : { rows: [] };

      return {
        tenantId,
        plano: tenant.plano,
        status: tenant.status,
        bloqueio: calcularBloqueioAssinatura(tenant),
        modulos: modRows.map((r) => r.modulo_key),
        limites: Object.fromEntries(limiteRows.map((r) => [r.chave, { valor: r.valor, unidade: r.unidade }])),
      };
    }
  );

  // Catálogo público de planos de um produto (default studio).
  fastify.get('/plans', async (request, reply) => {
    const produto = request.query.produto === 'people' ? 'people' : 'studio';

    const { rows: planos } = await pool.query(
      `SELECT chave, slug, nome, descricao, preco_mensal, tecnologia, tipo_numero,
              destaque, badge, headline_diferencial, frase_beneficio, herda_de
       FROM planos WHERE produto = $1 AND ativo = true
       ORDER BY preco_mensal`,
      [produto]
    );
    if (planos.length === 0) {
      return { produto, planos: [] };
    }

    const chaves = planos.map((p) => p.chave);
    const { rows: features } = await pool.query(
      'SELECT plano_chave, label, ordem FROM plano_features WHERE plano_chave = ANY($1::text[]) ORDER BY plano_chave, ordem',
      [chaves]
    );
    const { rows: limites } = await pool.query(
      'SELECT plano_chave, chave, valor, unidade FROM plano_limites WHERE plano_chave = ANY($1::text[])',
      [chaves]
    );

    return {
      produto,
      planos: planos.map((p) => ({
        ...p,
        preco_mensal: Number(p.preco_mensal),
        features: features.filter((f) => f.plano_chave === p.chave).map((f) => f.label),
        limites: Object.fromEntries(
          limites.filter((l) => l.plano_chave === p.chave).map((l) => [l.chave, { valor: l.valor, unidade: l.unidade }])
        ),
      })),
    };
  });
}

module.exports = { registerEntitlementsRoutes };
