// Portal admin — Sistema › Configurações (spec §13). Valores que alimentam
// constantes centrais (trial, carência de inadimplência, etc.), editáveis
// SEM deploy. Vinha do admin do Studio (`/admin/api/configuracoes/sistema`);
// a tabela `configuracoes_sistema` já está no schema `platform` e o serviço
// já lê dela (lib/configuracoes-sistema.js) — aqui só a escrita + auditoria.

const configSistema = require('../../lib/configuracoes-sistema');
const { registrarAuditoria } = require('../../lib/auditoria');

// Chaves que este endpoint reconhece (mesmas do seed de db/001). Outras no
// corpo são ignoradas.
const CHAVES = [
  'trial_dias',
  'carencia_dias_inadimplencia',
  'max_tentativas_reenvio_token',
  'email_suporte',
  'whatsapp_suporte',
];
const NUMERICAS = new Set([
  'trial_dias',
  'carencia_dias_inadimplencia',
  'max_tentativas_reenvio_token',
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function registerAdminSistemaConfigRoutes(fastify, pool) {
  fastify.get(
    '/admin/api/sistema/config',
    { preHandler: [fastify.authenticateAdmin, fastify.requirePermission('config:read')] },
    async () => {
      const { rows } = await pool.query(
        'SELECT chave, valor, atualizado_em FROM configuracoes_sistema WHERE chave = ANY($1::text[]) ORDER BY chave',
        [CHAVES],
      );
      return { config: rows };
    },
  );

  fastify.patch(
    '/admin/api/sistema/config',
    { preHandler: [fastify.authenticateAdmin, fastify.requirePermission('config:write')] },
    async (request, reply) => {
      const corpo = request.body || {};
      const enviadas = CHAVES.filter((c) => corpo[c] !== undefined);
      if (!enviadas.length) {
        return reply.code(400).send({ error: `Envie ao menos uma de: ${CHAVES.join(', ')}` });
      }
      for (const c of enviadas) {
        if (NUMERICAS.has(c)) {
          const n = Number(corpo[c]);
          if (!Number.isInteger(n) || n <= 0) {
            return reply.code(400).send({ error: `"${c}" deve ser inteiro maior que zero.` });
          }
        }
      }
      if (corpo.email_suporte !== undefined && !EMAIL_RE.test(String(corpo.email_suporte))) {
        return reply.code(400).send({ error: 'E-mail de suporte inválido.' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const c of enviadas) {
          const valorNovo = String(corpo[c]);
          const { rows: antes } = await client.query(
            'SELECT valor FROM configuracoes_sistema WHERE chave = $1 FOR UPDATE',
            [c],
          );
          const valorAntes = antes[0] ? antes[0].valor : null;
          if (valorAntes === valorNovo) continue;
          await client.query(
            'UPDATE configuracoes_sistema SET valor = $2, atualizado_em = now(), atualizado_por = $3 WHERE chave = $1',
            [c, valorNovo, request.admin.adminId],
          );
          await registrarAuditoria(client, {
            atorAdminId: request.admin.adminId,
            acao: 'sistema.config',
            entidadeTipo: 'configuracao_sistema',
            entidadeId: c,
            antes: { valor: valorAntes },
            depois: { valor: valorNovo },
            request,
          });
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      // Revalida o cache em memória pra valer no processo já rodando.
      await configSistema.carregar().catch((err) => {
        request.log.warn({ err }, 'config recarregada falhou (persistiu, cache stale até restart)');
      });

      const { rows } = await pool.query(
        'SELECT chave, valor, atualizado_em FROM configuracoes_sistema WHERE chave = ANY($1::text[]) ORDER BY chave',
        [CHAVES],
      );
      return { config: rows };
    },
  );
}

module.exports = { registerAdminSistemaConfigRoutes };
