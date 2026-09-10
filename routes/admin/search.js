// Portal admin — busca global (spec §14). Federada e enxuta pro MVP:
// empresas, usuários e telefones/PNID. Cada hit é
// { tipo, id, label, sublabel, href } — href é uma rota do SPA.

function registerAdminSearchRoutes(fastify, pool) {
  const guard = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('clientes:read')],
  };

  fastify.get('/admin/api/search', guard, async (request) => {
    const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (q.length < 2) return { resultados: [] };

    const like = `%${q}%`;
    const digitos = q.replace(/\D/g, '');

    const [empresas, usuarios, telefones] = await Promise.all([
      pool.query(
        `SELECT id, nome, plano FROM tenants
          WHERE excluido_em IS NULL AND nome ILIKE $1
          ORDER BY nome LIMIT 6`,
        [like],
      ),
      pool.query(
        `SELECT u.id, u.nome, u.email, t.id AS tenant_id, t.nome AS tenant_nome
           FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
          WHERE u.email ILIKE $1 OR u.nome ILIKE $1
          ORDER BY u.email LIMIT 6`,
        [like],
      ),
      digitos.length >= 4
        ? pool.query(
            `SELECT id, nome, whatsapp, telefone, meta_phone_number_id FROM tenants
              WHERE excluido_em IS NULL AND (
                whatsapp ILIKE $1 OR telefone ILIKE $1 OR meta_phone_number_id ILIKE $1
              )
              ORDER BY nome LIMIT 6`,
            [`%${digitos}%`],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const resultados = [];
    for (const e of empresas.rows) {
      resultados.push({
        tipo: 'empresa',
        id: e.id,
        label: e.nome,
        sublabel: `Empresa · ${e.plano || 'sem plano'}`,
        href: `/clientes/${e.id}`,
      });
    }
    for (const u of usuarios.rows) {
      resultados.push({
        tipo: 'usuario',
        id: u.id,
        label: u.nome || u.email,
        sublabel: `Usuário · ${u.email} · ${u.tenant_nome}`,
        href: `/clientes/${u.tenant_id}`,
      });
    }
    for (const t of telefones.rows) {
      resultados.push({
        tipo: 'telefone',
        id: t.id,
        label: t.whatsapp || t.telefone || t.meta_phone_number_id,
        sublabel: `Telefone / PNID · ${t.nome}`,
        href: `/clientes/${t.id}`,
      });
    }

    const vistos = new Set();
    return {
      resultados: resultados
        .filter((r) => {
          const k = `${r.tipo}:${r.id}`;
          if (vistos.has(k)) return false;
          vistos.add(k);
          return true;
        })
        .slice(0, 15),
    };
  });
}

module.exports = { registerAdminSearchRoutes };
