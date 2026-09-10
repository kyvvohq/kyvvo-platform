// Portal admin — Visão geral (spec §5). Central de operação: KPIs (todos
// clicáveis, levam ao filtro) + alertas de exceção que exigem ação.
//
// Só dados platform-native. IA (conversas/tokens/custo) mora no Studio
// (conversas_ia) — entra quando vier via adapter de produto.

const { statusContaTenant } = require('../../lib/trial-conta');

function registerAdminVisaoGeralRoutes(fastify, pool) {
  fastify.get(
    '/admin/api/visao-geral',
    { preHandler: [fastify.authenticateAdmin] },
    async () => {
      const [tenantsRes, produtosRes, whatsappRes, templatesRes, falhasRes] = await Promise.all([
        pool.query(
          `SELECT ativo, status, ativado_em, trial_expires_at, criado_em
             FROM tenants WHERE excluido_em IS NULL`,
        ),
        pool.query(
          `SELECT p.produto,
                  (SELECT count(*)::int FROM tenants t
                    WHERE t.excluido_em IS NULL AND t.plano IN (
                      SELECT chave FROM planos p2 WHERE p2.produto = p.produto
                    )) AS tenants
             FROM planos p GROUP BY p.produto ORDER BY p.produto`,
        ),
        pool.query(`
          SELECT
            (SELECT count(*)::int FROM tenants
              WHERE excluido_em IS NULL AND meta_phone_number_id IS NOT NULL) AS numeros,
            (SELECT count(*)::int FROM whatsapp_webhook_events
              WHERE recebido_em >= now() - interval '24 hours') AS eventos_24h,
            (SELECT count(*)::int FROM whatsapp_message_status
              WHERE status = 'failed' AND ts >= now() - interval '24 hours') AS falhas_24h
        `),
        pool.query(`SELECT count(*)::int AS n FROM message_templates WHERE estado = 'rejeitado'`),
        pool.query(`
          SELECT count(distinct phone_number_id)::int AS numeros_com_falha
            FROM whatsapp_message_status
           WHERE status = 'failed' AND ts >= now() - interval '24 hours'
        `),
      ]);

      const inicioMes = new Date();
      inicioMes.setUTCDate(1);
      inicioMes.setUTCHours(0, 0, 0, 0);
      let ativos = 0;
      let trial = 0;
      let inadimplentes = 0;
      let trialExpirado = 0;
      let novos = 0;
      for (const t of tenantsRes.rows) {
        const s = statusContaTenant(t);
        if (s === 'Ativo') ativos += 1;
        else if (s === 'Trial ativo') trial += 1;
        else if (s === 'Trial expirado') trialExpirado += 1;
        if (t.status === 'inadimplente') inadimplentes += 1;
        if (t.criado_em && new Date(t.criado_em) >= inicioMes) novos += 1;
      }
      const totalClientes = tenantsRes.rows.length;
      const inativos = totalClientes - ativos - trial;
      const wa = whatsappRes.rows[0];
      const templatesRejeitados = templatesRes.rows[0].n;
      const numerosComFalha = falhasRes.rows[0].numeros_com_falha;

      // Alertas — cada um leva a um filtro. severidade: alta | media.
      const alertas = [];
      if (inadimplentes > 0) {
        alertas.push({
          tipo: 'billing',
          severidade: 'alta',
          texto: `${inadimplentes} empresa(s) inadimplente(s)`,
          href: '/plataforma/assinaturas',
        });
      }
      if (numerosComFalha > 0) {
        alertas.push({
          tipo: 'whatsapp',
          severidade: 'alta',
          texto: `${numerosComFalha} número(s) com falha de envio nas últimas 24h`,
          href: '/whatsapp',
        });
      }
      if (templatesRejeitados > 0) {
        alertas.push({
          tipo: 'template',
          severidade: 'media',
          texto: `${templatesRejeitados} template(s) rejeitado(s)`,
          href: '/campanhas?estado=rejeitado',
        });
      }
      if (trialExpirado > 0) {
        alertas.push({
          tipo: 'clientes',
          severidade: 'media',
          texto: `${trialExpirado} empresa(s) com trial expirado`,
          href: '/clientes?status=inativo',
        });
      }

      return {
        clientes: { total: totalClientes, ativos, trial, inativos, novos_mes: novos },
        produtos: produtosRes.rows,
        whatsapp: {
          numeros: wa.numeros,
          eventos_24h: wa.eventos_24h,
          falhas_24h: wa.falhas_24h,
        },
        alertas,
      };
    },
  );
}

module.exports = { registerAdminVisaoGeralRoutes };
