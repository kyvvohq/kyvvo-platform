// Portal admin — autenticação. POST /admin/api/auth/{login,refresh},
// GET /admin/api/auth/me.
//
// Isolado do login de tenant (routes/auth.js): tabela própria (admin_users),
// token com `aud: "admin"` (lib/admin-session.js). Sem verificação de e-mail,
// sem trial/bloqueio — é o time interno da Kyvvo.

const bcrypt = require('bcryptjs');
const adminSession = require('../../lib/admin-session');

function registerAdminAuthRoutes(fastify, pool) {
  fastify.post('/admin/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios.' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, nome, senha_hash, ativo FROM admin_users WHERE email = $1',
      [String(email).toLowerCase().trim()]
    );
    const admin = rows[0];
    // Mesma mensagem pros três casos (não existe / inativo / senha errada) —
    // não revela quais e-mails são de admin.
    if (!admin || !admin.ativo || !(await bcrypt.compare(senha, admin.senha_hash))) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos.' });
    }

    await pool.query('UPDATE admin_users SET ultimo_login_em = now() WHERE id = $1', [admin.id]);
    return { token: adminSession.assinar(admin) };
  });

  // Renova um token vencido há pouco: aceita expirado, revalida o admin no
  // banco (pode ter sido desativado no meio-tempo), reemite. Mesmo mecanismo
  // do /api/auth/refresh de tenant.
  fastify.post('/admin/api/auth/refresh', async (request, reply) => {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;

    let payload;
    try {
      payload = adminSession.verificar(token, { ignoreExpiration: true });
    } catch (err) {
      return reply.code(401).send({ error: 'Token inválido.' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, nome, ativo FROM admin_users WHERE id = $1',
      [payload.adminId]
    );
    const admin = rows[0];
    if (!admin || !admin.ativo) {
      return reply.code(401).send({ error: 'Acesso de admin desativado.' });
    }
    return { token: adminSession.assinar(admin) };
  });

  // O SPA chama isto no boot pra montar a navegação conforme as permissões.
  fastify.get(
    '/admin/api/auth/me',
    { preHandler: [fastify.authenticateAdmin] },
    async (request) => ({
      adminId: request.admin.adminId,
      email: request.admin.email,
      nome: request.admin.nome,
      roles: request.admin.roles,
      perms: [...request.admin.perms],
    })
  );
}

module.exports = { registerAdminAuthRoutes };
