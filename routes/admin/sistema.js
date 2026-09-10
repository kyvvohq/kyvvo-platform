// Portal admin — Sistema (spec §13): auditoria e feature flags.
// (Admins & papéis ficam em routes/admin/sistema-admins.js.)

const { registrarAuditoria } = require('../../lib/auditoria');

const ESCOPOS = ['global', 'produto', 'tenant'];

function registerAdminSistemaRoutes(fastify, pool) {
  const lerAuditoria = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('auditoria:read')],
  };
  const lerFlags = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('flag:read')],
  };
  const escreverFlags = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('flag:write')],
  };

  // ---- Auditoria ----
  fastify.get('/admin/api/sistema/auditoria', lerAuditoria, async (request) => {
    const q = request.query || {};
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 30, 1), 100);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const cond = [];
    const params = [];
    if (q.acao) {
      params.push(`%${q.acao}%`);
      cond.push(`e.acao ILIKE $${params.length}`);
    }
    if (q.entidade_tipo) {
      params.push(q.entidade_tipo);
      cond.push(`e.entidade_tipo = $${params.length}`);
    }
    if (q.tenant_id) {
      params.push(q.tenant_id);
      cond.push(`e.tenant_id = $${params.length}`);
    }
    if (q.ator) {
      params.push(`%${q.ator}%`);
      cond.push(`(a.nome ILIKE $${params.length} OR a.email ILIKE $${params.length})`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const { rows: totalRows } = await pool.query(
      `SELECT count(*)::int AS total
         FROM audit_events e LEFT JOIN admin_users a ON a.id = e.ator_admin_id ${where}`,
      params,
    );

    const { rows } = await pool.query(
      `SELECT e.id, e.acao, e.entidade_tipo, e.entidade_id, e.tenant_id,
              e.valor_antes, e.valor_depois, e.ip, e.criado_em,
              a.nome AS ator_nome, a.email AS ator_email
         FROM audit_events e
         LEFT JOIN admin_users a ON a.id = e.ator_admin_id
         ${where}
        ORDER BY e.criado_em DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      eventos: rows,
      page,
      limit,
      total: totalRows[0].total,
      total_paginas: Math.max(Math.ceil(totalRows[0].total / limit), 1),
    };
  });

  // ---- Feature flags ----
  fastify.get('/admin/api/sistema/flags', lerFlags, async () => {
    const { rows } = await pool.query(
      `SELECT f.chave, f.escopo, f.alvo, f.valor, f.atualizado_em, a.nome AS atualizado_por_nome
         FROM feature_flags f LEFT JOIN admin_users a ON a.id = f.atualizado_por
        ORDER BY f.chave, f.escopo, f.alvo`,
    );
    return { flags: rows };
  });

  fastify.put('/admin/api/sistema/flags', escreverFlags, async (request, reply) => {
    const b = request.body || {};
    const chave = (b.chave || '').trim();
    const escopo = ESCOPOS.includes(b.escopo) ? b.escopo : 'global';
    const alvo = escopo === 'global' ? '*' : (b.alvo || '').trim();
    if (!chave) return reply.code(400).send({ error: 'chave é obrigatória' });
    if (escopo !== 'global' && !alvo) {
      return reply.code(400).send({ error: 'alvo é obrigatório para escopo produto/tenant' });
    }
    if (typeof b.valor !== 'boolean') {
      return reply.code(400).send({ error: 'valor deve ser booleano' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: antesRows } = await client.query(
        'SELECT valor FROM feature_flags WHERE chave = $1 AND escopo = $2 AND alvo = $3 FOR UPDATE',
        [chave, escopo, alvo],
      );
      const { rows } = await client.query(
        `INSERT INTO feature_flags (chave, escopo, alvo, valor, atualizado_por, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (chave, escopo, alvo)
           DO UPDATE SET valor = $4, atualizado_por = $5, atualizado_em = now()
         RETURNING chave, escopo, alvo, valor`,
        [chave, escopo, alvo, b.valor, request.admin.adminId],
      );
      await registrarAuditoria(client, {
        atorAdminId: request.admin.adminId,
        acao: 'feature_flag.set',
        entidadeTipo: 'feature_flag',
        entidadeId: `${chave}:${escopo}:${alvo}`,
        antes: antesRows[0] ? { valor: antesRows[0].valor } : null,
        depois: { valor: b.valor },
        request,
      });
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  fastify.delete(
    '/admin/api/sistema/flags/:chave/:escopo/:alvo',
    escreverFlags,
    async (request, reply) => {
      const { chave, escopo, alvo } = request.params;
      const { rowCount } = await pool.query(
        'DELETE FROM feature_flags WHERE chave = $1 AND escopo = $2 AND alvo = $3',
        [chave, escopo, alvo],
      );
      if (!rowCount) return reply.code(404).send({ error: 'Flag não encontrada' });
      await registrarAuditoria(pool, {
        atorAdminId: request.admin.adminId,
        acao: 'feature_flag.remover',
        entidadeTipo: 'feature_flag',
        entidadeId: `${chave}:${escopo}:${alvo}`,
        request,
      });
      return { ok: true };
    },
  );
}

module.exports = { registerAdminSistemaRoutes };
