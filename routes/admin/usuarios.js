// Portal admin — Usuários. Busca global de usuários da plataforma (spec §6:
// "pesquisar usuário globalmente e identificar empresas às quais pertence").
// Cada usuário pertence a exatamente um tenant (`usuarios.tenant_id`), então
// "as empresas do usuário" = a empresa dele; a linha já leva pra 360° dela.

function registerAdminUsuariosRoutes(fastify, pool) {
  const guard = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('clientes:read')],
  };

  fastify.get('/admin/api/usuarios', guard, async (request) => {
    const q = request.query || {};
    const busca = typeof q.busca === 'string' ? q.busca.trim() : '';
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const cond = [];
    const params = [];
    if (busca) {
      params.push(`%${busca}%`);
      cond.push(`(u.email ILIKE $${params.length} OR u.nome ILIKE $${params.length})`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const { rows: totalRows } = await pool.query(
      `SELECT count(*)::int AS total FROM usuarios u ${where}`,
      params,
    );
    const total = totalRows[0].total;

    const { rows } = await pool.query(
      `SELECT u.id, u.nome, u.email, u.role, u.email_verified, u.ativo, u.criado_em,
              t.id AS tenant_id, t.nome AS tenant_nome, t.excluido_em AS tenant_excluido
         FROM usuarios u
         JOIN tenants t ON t.id = u.tenant_id
         ${where}
        ORDER BY u.criado_em DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      usuarios: rows.map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        role: u.role,
        email_verified: u.email_verified,
        ativo: u.ativo,
        criado_em: u.criado_em,
        empresa: { id: u.tenant_id, nome: u.tenant_nome, excluida: !!u.tenant_excluido },
      })),
      page,
      limit,
      total,
      total_paginas: Math.max(Math.ceil(total / limit), 1),
    };
  });
}

module.exports = { registerAdminUsuariosRoutes };
