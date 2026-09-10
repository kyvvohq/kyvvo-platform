// Portal admin — Plataforma (spec §12): planos, assinaturas e billing dos
// serviços comuns. Nesta fase é só leitura. Edição de plano com
// versionamento (spec §12) fica pra uma leva seguinte — mexer em
// `plano_limites` hoje afeta retroativamente quem já está no plano (o
// entitlements resolve ao vivo), então isso precisa de modelagem própria.

const { montarResumoPagamentos } = require('../../lib/pagamentos');
const { statusContaTenant } = require('../../lib/trial-conta');

function registerAdminPlataformaRoutes(fastify, pool) {
  const guard = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('billing:read')],
  };

  // Catálogo completo (todos os produtos, inclusive planos inativos) com
  // features e limites.
  fastify.get('/admin/api/plataforma/planos', guard, async () => {
    const { rows: planos } = await pool.query(
      `SELECT chave, slug, produto, nome, descricao, preco_mensal, tecnologia, tipo_numero,
              destaque, badge, herda_de, ativo, atualizado_em
         FROM planos ORDER BY produto, preco_mensal`,
    );
    const chaves = planos.map((p) => p.chave);
    const [{ rows: features }, { rows: limites }] = await Promise.all([
      chaves.length
        ? pool.query(
            'SELECT plano_chave, label, ordem FROM plano_features WHERE plano_chave = ANY($1::text[]) ORDER BY plano_chave, ordem',
            [chaves],
          )
        : Promise.resolve({ rows: [] }),
      chaves.length
        ? pool.query(
            'SELECT plano_chave, chave, valor, unidade FROM plano_limites WHERE plano_chave = ANY($1::text[])',
            [chaves],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    return {
      planos: planos.map((p) => ({
        ...p,
        preco_mensal: Number(p.preco_mensal),
        features: features.filter((f) => f.plano_chave === p.chave).map((f) => f.label),
        limites: Object.fromEntries(
          limites
            .filter((l) => l.plano_chave === p.chave)
            .map((l) => [l.chave, { valor: l.valor, unidade: l.unidade }]),
        ),
      })),
    };
  });

  // Lista de assinaturas — 1 chamada Asaas por tenant que tem subscription
  // (montarResumoPagamentos). Volume de pagantes é baixo; se crescer, virar
  // cache/materializado.
  fastify.get('/admin/api/plataforma/assinaturas', guard, async () => {
    const { rows } = await pool.query(
      `SELECT id, nome, ativo, plano, status, ativado_em, status_alterado_em, acesso_ate,
              trial_expires_at, asaas_customer_id, asaas_subscription_id, asaas_meio_pagamento,
              asaas_cartao_final, cancelado_em
         FROM tenants WHERE excluido_em IS NULL ORDER BY nome`,
    );
    const assinaturas = await Promise.all(
      rows.map(async (t) => {
        const pag = await montarResumoPagamentos(t);
        return {
          id: t.id,
          nome: t.nome,
          status_conta: statusContaTenant(t),
          plano_nome: pag.plano_nome,
          valor_plano: pag.valor_plano,
          proxima_cobranca: pag.proxima_cobranca,
          meio_pagamento: t.asaas_meio_pagamento || null,
          cartao_final: t.asaas_cartao_final || null,
          tem_assinatura_asaas: !!t.asaas_subscription_id,
        };
      }),
    );
    return { assinaturas };
  });

  // Billing de um tenant (lazy-load da seção Billing da 360°) — resumo Asaas
  // ao vivo pra um só, não pra lista.
  fastify.get('/admin/api/plataforma/assinaturas/:id', guard, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await pool.query(
      `SELECT id, nome, plano, status, ativado_em, status_alterado_em, acesso_ate, trial_expires_at,
              asaas_customer_id, asaas_subscription_id, asaas_meio_pagamento, asaas_cartao_final,
              asaas_meio_pagamento_alterado_em, cancelado_em
         FROM tenants WHERE id = $1 AND excluido_em IS NULL`,
      [id],
    );
    const tenant = rows[0];
    if (!tenant) return reply.code(404).send({ error: 'Empresa não encontrada' });

    const pag = await montarResumoPagamentos(tenant);
    return {
      status_conta: statusContaTenant(tenant),
      plano_nome: pag.plano_nome,
      valor_plano: pag.valor_plano,
      proxima_cobranca: pag.proxima_cobranca,
      meio_pagamento: tenant.asaas_meio_pagamento || null,
      cartao_final: tenant.asaas_cartao_final || null,
      meio_pagamento_alterado_em: tenant.asaas_meio_pagamento_alterado_em || null,
      asaas_customer_id: tenant.asaas_customer_id || null,
      asaas_subscription_id: tenant.asaas_subscription_id || null,
      cancelado_em: tenant.cancelado_em || null,
    };
  });
}

module.exports = { registerAdminPlataformaRoutes };
