// Portal admin — Números prontos (US39.2). O inventário e a Meta Cloud API
// vivem no Studio; aqui o platform aplica o RBAC, grava a auditoria e
// repassa o resultado do adapter. `whatsapp:disable` pras escritas
// (provisionar número é operação de risco).

const { chamarAdapterStudio } = require('../../lib/product-adapters');
const { registrarAuditoria } = require('../../lib/auditoria');

function registerAdminNumerosProntosRoutes(fastify, pool) {
  const ler = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('whatsapp:read')],
  };
  const escrever = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('whatsapp:disable')],
  };

  fastify.get('/admin/api/whatsapp/numeros-prontos', ler, async (request, reply) => {
    const r = await chamarAdapterStudio('GET', '/numeros-prontos');
    return reply.code(r.status).send(r.body);
  });

  fastify.post('/admin/api/whatsapp/numeros-prontos', escrever, async (request, reply) => {
    const r = await chamarAdapterStudio('POST', '/numeros-prontos', request.body || {});
    if (r.status < 300) {
      await registrarAuditoria(pool, {
        atorAdminId: request.admin.adminId,
        acao: 'numero_pronto.cadastrar',
        entidadeTipo: 'numero_pronto',
        entidadeId: r.body && r.body.id ? String(r.body.id) : null,
        depois: r.body || null,
        request,
      });
    }
    return reply.code(r.status).send(r.body);
  });

  fastify.post(
    '/admin/api/whatsapp/numeros-prontos/:id/vincular',
    escrever,
    async (request, reply) => {
      const r = await chamarAdapterStudio(
        'POST',
        `/numeros-prontos/${request.params.id}/vincular`,
        request.body || {},
      );
      if (r.status < 300) {
        await registrarAuditoria(pool, {
          atorAdminId: request.admin.adminId,
          acao: 'numero_pronto.vincular',
          entidadeTipo: 'numero_pronto',
          entidadeId: String(request.params.id),
          tenantId: (request.body || {}).tenant_id || null,
          depois: r.body ? { meta_phone_number_id: r.body.meta_phone_number_id } : null,
          request,
        });
      }
      return reply.code(r.status).send(r.body);
    },
  );

  fastify.post(
    '/admin/api/whatsapp/numeros-prontos/:id/testar',
    escrever,
    async (request, reply) => {
      const r = await chamarAdapterStudio(
        'POST',
        `/numeros-prontos/${request.params.id}/testar`,
        request.body || {},
      );
      if (r.status < 300) {
        await registrarAuditoria(pool, {
          atorAdminId: request.admin.adminId,
          acao: 'numero_pronto.testar',
          entidadeTipo: 'numero_pronto',
          entidadeId: String(request.params.id),
          depois: r.body ? { status: r.body.status } : null,
          request,
        });
      }
      return reply.code(r.status).send(r.body);
    },
  );
}

module.exports = { registerAdminNumerosProntosRoutes };
