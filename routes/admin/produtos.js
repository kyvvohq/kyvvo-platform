// Portal admin — Produtos. Governança dos módulos/entitlements da plataforma
// (spec §7). O catálogo em si mora em `modulos` + `plano_limites`; a ativação
// por tenant é `tenant_modulos` (mexida em routes/admin/clientes.js, com
// auditoria). Aqui só a visão agregada pra área "Produtos" do menu.

function registerAdminProdutosRoutes(fastify, pool) {
  const guard = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('clientes:read')],
  };

  fastify.get('/admin/api/produtos', guard, async () => {
    const { rows: modulos } = await pool.query(
      `SELECT m.key, m.nome, m.obrigatorio, m.preco_mensal,
              (SELECT count(*)::int FROM tenant_modulos tm
                WHERE tm.modulo_key = m.key AND tm.ativo) AS tenants_ativos
         FROM modulos m
        ORDER BY m.obrigatorio DESC, m.nome`,
    );

    const { rows: planosProduto } = await pool.query(
      `SELECT produto, count(*)::int AS planos,
              (SELECT count(*)::int FROM tenants t
                WHERE t.excluido_em IS NULL AND t.plano IN (
                  SELECT chave FROM planos p2 WHERE p2.produto = p.produto
                )) AS tenants
         FROM planos p GROUP BY produto ORDER BY produto`,
    );

    return {
      modulos: modulos.map((m) => ({
        key: m.key,
        nome: m.nome,
        obrigatorio: m.obrigatorio,
        preco_mensal: m.preco_mensal == null ? null : Number(m.preco_mensal),
        tenants_ativos: m.tenants_ativos,
      })),
      produtos: planosProduto,
    };
  });
}

module.exports = { registerAdminProdutosRoutes };
