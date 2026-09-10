// Portal admin — Sistema › Admins & Papéis (spec §13). Gerência do time
// interno: criar admin, ativar/desativar, atribuir papéis. Papéis e
// permissões são fixos (seed de db/004) — aqui só a atribuição.

const bcrypt = require('bcryptjs');
const { registrarAuditoria } = require('../../lib/auditoria');

async function rolesDoAdmin(exec, adminId) {
  const { rows } = await exec.query(
    'SELECT role_chave FROM admin_user_roles WHERE admin_id = $1 ORDER BY role_chave',
    [adminId],
  );
  return rows.map((r) => r.role_chave);
}

function registerAdminSistemaAdminsRoutes(fastify, pool) {
  const guard = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('admin:manage')],
  };

  fastify.get('/admin/api/sistema/admins', guard, async () => {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.nome, u.ativo, u.ultimo_login_em, u.criado_em,
              coalesce(
                array_agg(ur.role_chave ORDER BY ur.role_chave) FILTER (WHERE ur.role_chave IS NOT NULL),
                '{}'
              ) AS roles
         FROM admin_users u
         LEFT JOIN admin_user_roles ur ON ur.admin_id = u.id
        GROUP BY u.id
        ORDER BY u.criado_em`,
    );
    return { admins: rows };
  });

  fastify.get('/admin/api/sistema/papeis', guard, async () => {
    const [{ rows: roles }, { rows: perms }, { rows: mapa }] = await Promise.all([
      pool.query('SELECT chave, nome, descricao FROM admin_roles ORDER BY chave'),
      pool.query('SELECT chave, descricao FROM admin_permissions ORDER BY chave'),
      pool.query('SELECT role_chave, permission_chave FROM admin_role_permissions'),
    ]);
    return {
      roles: roles.map((r) => ({
        ...r,
        permissoes: mapa.filter((m) => m.role_chave === r.chave).map((m) => m.permission_chave),
      })),
      permissoes: perms,
    };
  });

  fastify.post('/admin/api/sistema/admins', guard, async (request, reply) => {
    const b = request.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    const senha = String(b.senha || '');
    const roles = Array.isArray(b.roles) ? b.roles : [];
    if (!email || !senha) return reply.code(400).send({ error: 'E-mail e senha são obrigatórios.' });
    if (senha.length < 10) return reply.code(400).send({ error: 'Senha muito curta (mín. 10).' });

    const { rows: rolesValidas } = await pool.query('SELECT chave FROM admin_roles');
    const validas = new Set(rolesValidas.map((r) => r.chave));
    const ruim = roles.find((r) => !validas.has(r));
    if (ruim) return reply.code(400).send({ error: `papel inválido: ${ruim}` });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hash = await bcrypt.hash(senha, 10);
      const { rows } = await client.query(
        'INSERT INTO admin_users (email, senha_hash, nome) VALUES ($1, $2, $3) RETURNING id, email, nome, ativo',
        [email, hash, b.nome || null],
      );
      const admin = rows[0];
      for (const r of roles) {
        await client.query(
          'INSERT INTO admin_user_roles (admin_id, role_chave) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [admin.id, r],
        );
      }
      await registrarAuditoria(client, {
        atorAdminId: request.admin.adminId,
        acao: 'admin.criar',
        entidadeTipo: 'admin_user',
        entidadeId: admin.id,
        depois: { email, roles },
        request,
      });
      await client.query('COMMIT');
      reply.code(201);
      return { ...admin, roles };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') return reply.code(409).send({ error: 'Já existe um admin com esse e-mail.' });
      throw e;
    } finally {
      client.release();
    }
  });

  fastify.patch('/admin/api/sistema/admins/:id', guard, async (request, reply) => {
    const { id } = request.params;
    const b = request.body || {};

    if (id === request.admin.adminId && b.ativo === false) {
      return reply.code(409).send({ error: 'Você não pode desativar a si mesmo.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, email, nome, ativo FROM admin_users WHERE id = $1 FOR UPDATE',
        [id],
      );
      const alvo = rows[0];
      if (!alvo) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Admin não encontrado' });
      }
      const rolesAntes = await rolesDoAdmin(client, id);

      let rolesDepois = rolesAntes;
      if (Array.isArray(b.roles)) {
        const { rows: rolesValidas } = await client.query('SELECT chave FROM admin_roles');
        const validas = new Set(rolesValidas.map((r) => r.chave));
        const ruim = b.roles.find((r) => !validas.has(r));
        if (ruim) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: `papel inválido: ${ruim}` });
        }
        rolesDepois = [...new Set(b.roles)];
      }

      // Trava anti-lockout: não deixar a plataforma sem nenhum superadmin ativo.
      const perdeuSuperadmin =
        rolesAntes.includes('superadmin') && !rolesDepois.includes('superadmin');
      const vaiFicarInativo = b.ativo === false;
      if ((perdeuSuperadmin || vaiFicarInativo) && rolesAntes.includes('superadmin')) {
        const { rows: outros } = await client.query(
          `SELECT count(*)::int AS n
             FROM admin_user_roles ur JOIN admin_users u ON u.id = ur.admin_id
            WHERE ur.role_chave = 'superadmin' AND u.ativo AND u.id <> $1`,
          [id],
        );
        if (outros[0].n === 0) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'Não dá pra remover o último superadmin ativo.' });
        }
      }

      const { rows: upd } = await client.query(
        `UPDATE admin_users SET
           nome = COALESCE($2, nome),
           ativo = COALESCE($3, ativo)
         WHERE id = $1 RETURNING id, email, nome, ativo`,
        [id, b.nome ?? null, typeof b.ativo === 'boolean' ? b.ativo : null],
      );

      if (Array.isArray(b.roles)) {
        await client.query('DELETE FROM admin_user_roles WHERE admin_id = $1', [id]);
        for (const r of rolesDepois) {
          await client.query('INSERT INTO admin_user_roles (admin_id, role_chave) VALUES ($1, $2)', [
            id,
            r,
          ]);
        }
      }

      await registrarAuditoria(client, {
        atorAdminId: request.admin.adminId,
        acao: 'admin.atualizar',
        entidadeTipo: 'admin_user',
        entidadeId: id,
        antes: { ativo: alvo.ativo, roles: rolesAntes },
        depois: { ativo: upd[0].ativo, roles: rolesDepois },
        request,
      });
      await client.query('COMMIT');
      return { ...upd[0], roles: rolesDepois };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
}

module.exports = { registerAdminSistemaAdminsRoutes };
