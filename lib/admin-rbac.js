// Guards do portal admin: `authenticateAdmin` + `requirePermission`.
//
// authenticateAdmin — valida o JWT (aud "admin"), recarrega o admin do banco
// a cada request (checa `ativo`) e resolve papéis + permissões. Espelha o
// lookup-por-request de lib/auth-guards.js: revogar acesso = desativar o
// admin (`admin_users.ativo = false`), efeito imediato no próximo request.
//
// requirePermission('clientes:suspend') — preHandler que exige a permissão;
// 403 se faltar. Encadear sempre depois de authenticateAdmin.

const adminSession = require('./admin-session');

function registrarGuardsAdmin(fastify, pool) {
  fastify.decorate('authenticateAdmin', async (request, reply) => {
    let payload;
    try {
      const header = request.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : header;
      payload = adminSession.verificar(token);
    } catch (err) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.nome, u.ativo,
              coalesce(
                array_agg(distinct ur.role_chave) filter (where ur.role_chave is not null),
                '{}'
              ) AS roles,
              coalesce(
                array_agg(distinct rp.permission_chave) filter (where rp.permission_chave is not null),
                '{}'
              ) AS perms
         FROM admin_users u
         LEFT JOIN admin_user_roles ur ON ur.admin_id = u.id
         LEFT JOIN admin_role_permissions rp ON rp.role_chave = ur.role_chave
        WHERE u.id = $1
        GROUP BY u.id`,
      [payload.adminId]
    );
    const admin = rows[0];
    if (!admin || !admin.ativo) {
      return reply.code(401).send({ error: 'Acesso de admin desativado.' });
    }

    request.admin = {
      adminId: admin.id,
      email: admin.email,
      nome: admin.nome,
      roles: admin.roles,
      perms: new Set(admin.perms),
    };
  });

  fastify.decorate('requirePermission', (permissao) => async (request, reply) => {
    if (!request.admin || !request.admin.perms.has(permissao)) {
      return reply.code(403).send({ error: `Sem permissão: ${permissao}` });
    }
  });
}

module.exports = { registrarGuardsAdmin };
