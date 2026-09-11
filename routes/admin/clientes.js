// Portal admin — Clientes (empresas / tenants). Só leitura da camada
// `platform`. Dados específicos de produto (agenda, vagas, …) vêm do adapter
// de cada produto (Fase 2), nunca de um SELECT no banco alheio. Escrita
// sensível (suspender / reativar / alterar plano) numa fase seguinte.

const planos = require('../../lib/planos');
const { calcularTrialTenant, statusContaTenant } = require('../../lib/trial-conta');
const { buscarPaineisProduto } = require('../../lib/product-adapters');
const { registrarAuditoria } = require('../../lib/auditoria');

// Colunas ordenáveis — mapa explícito, nunca interpolar order_by cru.
const ORDER_COLUMNS = {
  nome: 't.nome',
  criado_em: 't.criado_em',
  ativado_em: 't.ativado_em',
  status: 't.status',
};

// Enum legado de tenants.segmento (CHECK da migration 018 do Studio) — usado
// só pela edição de cadastro do admin. O cadastro self-service usa
// segmento_id → tabela `segmentos`.
const SEGMENTOS_VALIDOS = ['salao_beleza', 'petshop', 'psicologia', 'fisioterapia', 'pilates', 'outro'];

// Buckets do filtro "Status ▾" — chave do frontend → rótulos de
// statusContaTenant. "inativo" cobre tudo que não é Ativo / Trial ativo,
// mesmo agrupamento do card de resumo (pra a soma bater).
const STATUS_FILTRO = {
  ativo: ['Ativo'],
  trial: ['Trial ativo'],
  inativo: ['Inativo', 'Suspenso', 'Trial expirado', 'Não ativado'],
};

function registerAdminClientesRoutes(fastify, pool) {
  const guard = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('clientes:read')],
  };

  // KPIs pro header de Clientes e pra Visão geral.
  fastify.get('/admin/api/clientes/resumo', guard, async () => {
    const { rows } = await pool.query(
      `SELECT ativo, status, ativado_em, trial_expires_at, criado_em
         FROM tenants WHERE excluido_em IS NULL`,
    );
    const inicioMes = new Date();
    inicioMes.setUTCDate(1);
    inicioMes.setUTCHours(0, 0, 0, 0);

    let ativos = 0;
    let trial = 0;
    let novos = 0;
    for (const t of rows) {
      const s = statusContaTenant(t);
      if (s === 'Ativo') ativos += 1;
      else if (s === 'Trial ativo') trial += 1;
      if (t.criado_em && new Date(t.criado_em) >= inicioMes) novos += 1;
    }
    return {
      total: rows.length,
      ativos,
      trial,
      inativos: rows.length - ativos - trial,
      novos_mes: novos,
    };
  });

  // Catálogo pros selects de filtro do frontend.
  fastify.get('/admin/api/clientes/filtros', guard, async () => {
    const { rows: modulos } = await pool.query('SELECT key, nome FROM modulos ORDER BY nome');
    return {
      planos: planos
        .obterTodos()
        .filter((p) => p.ativo)
        .sort((a, b) => Number(a.preco_mensal) - Number(b.preco_mensal))
        .map((p) => ({ chave: p.chave, nome: p.nome, produto: p.produto })),
      modulos,
      status: [
        { chave: 'ativo', rotulo: 'Ativo' },
        { chave: 'trial', rotulo: 'Trial' },
        { chave: 'inativo', rotulo: 'Inativo / suspenso' },
      ],
    };
  });

  // Lista de empresas — busca (nome / telefone / whatsapp / e-mail ou nome de
  // usuário), filtros (status, plano, módulo, whatsapp) e paginação.
  fastify.get('/admin/api/clientes', guard, async (request) => {
    const q = request.query || {};
    const busca = typeof q.busca === 'string' ? q.busca.trim() : '';
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const orderCol = ORDER_COLUMNS[q.order_by] || ORDER_COLUMNS.criado_em;
    const orderDir = String(q.order_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const cond = ['t.excluido_em IS NULL'];
    const params = [];
    if (busca) {
      params.push(`%${busca}%`);
      const p = `$${params.length}`;
      cond.push(
        `(t.nome ILIKE ${p} OR t.whatsapp ILIKE ${p} OR t.telefone ILIKE ${p}
          OR EXISTS (SELECT 1 FROM usuarios u WHERE u.tenant_id = t.id AND (u.email ILIKE ${p} OR u.nome ILIKE ${p})))`,
      );
    }
    if (q.plano) {
      params.push(q.plano);
      cond.push(`t.plano = $${params.length}`);
    }
    if (q.modulo) {
      params.push(q.modulo);
      cond.push(
        `EXISTS (SELECT 1 FROM tenant_modulos tm WHERE tm.tenant_id = t.id AND tm.modulo_key = $${params.length} AND tm.ativo)`,
      );
    }
    if (q.whatsapp === 'sim') cond.push('t.meta_phone_number_id IS NOT NULL');
    if (q.whatsapp === 'nao') cond.push('t.meta_phone_number_id IS NULL');

    const where = `WHERE ${cond.join(' AND ')}`;

    const { rows } = await pool.query(
      `SELECT t.id, t.nome, t.whatsapp, t.telefone, t.ativo, t.status, t.plano,
              t.criado_em, t.ativado_em, t.trial_expires_at, t.meta_phone_number_id,
              resp.nome AS responsavel_nome, resp.email AS responsavel_email,
              (SELECT count(*)::int FROM usuarios u WHERE u.tenant_id = t.id) AS total_usuarios
         FROM tenants t
         LEFT JOIN LATERAL (
           SELECT nome, email FROM usuarios WHERE tenant_id = t.id ORDER BY criado_em ASC LIMIT 1
         ) resp ON true
         ${where}
        ORDER BY ${orderCol} ${orderDir} NULLS LAST`,
      params,
    );

    let linhas = rows.map((t) => ({
      id: t.id,
      nome: t.nome,
      whatsapp: t.whatsapp,
      telefone: t.telefone,
      ativo: t.ativo,
      status: t.status,
      plano: t.plano,
      plano_nome: planos.nomeDoPlano(t.plano),
      criado_em: t.criado_em,
      ativado_em: t.ativado_em,
      responsavel_nome: t.responsavel_nome,
      responsavel_email: t.responsavel_email,
      total_usuarios: t.total_usuarios,
      status_conta: statusContaTenant(t),
      trial_dias_restantes: calcularTrialTenant(t).trialDiasRestantes,
      whatsapp_conectado: !!t.meta_phone_number_id,
    }));

    // status_conta é derivado (depende do cálculo de trial, não é coluna) —
    // filtra em memória depois de calcular. Volume de tenants é baixo.
    const statusFiltro = STATUS_FILTRO[q.status];
    if (statusFiltro) linhas = linhas.filter((t) => statusFiltro.includes(t.status_conta));

    const total = linhas.length;
    const offset = (page - 1) * limit;
    return {
      clientes: linhas.slice(offset, offset + limit),
      page,
      limit,
      total,
      total_paginas: Math.max(Math.ceil(total / limit), 1),
    };
  });

  // 360° de uma empresa — só dados da plataforma. Os painéis de produto
  // (agenda / vagas / …) entram via adapter na Fase 2 (`produtos: []` por ora).
  fastify.get('/admin/api/clientes/:id', guard, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    const tenant = rows[0];
    if (!tenant || tenant.excluido_em) {
      return reply.code(404).send({ error: 'Empresa não encontrada' });
    }

    const [{ rows: usuarios }, { rows: modulos }, limitesRes, { rows: atividade }, produtos] =
      await Promise.all([
        pool.query(
          `SELECT id, nome, email, role, email_verified, ativo, criado_em
             FROM usuarios WHERE tenant_id = $1 ORDER BY criado_em ASC`,
          [id],
        ),
        pool.query(
          `SELECT m.key, m.nome, m.obrigatorio, COALESCE(tm.ativo, false) AS ativo
             FROM modulos m
             LEFT JOIN tenant_modulos tm ON tm.tenant_id = $1 AND tm.modulo_key = m.key
            ORDER BY m.nome`,
          [id],
        ),
        tenant.plano
          ? pool.query('SELECT chave, valor, unidade FROM plano_limites WHERE plano_chave = $1', [
              tenant.plano,
            ])
          : Promise.resolve({ rows: [] }),
        pool.query(
          'SELECT tipo, criado_em FROM eventos_analytics WHERE tenant_id = $1 ORDER BY criado_em DESC LIMIT 20',
          [id],
        ),
        // Painéis de produto via adapter (spec §16) — degrada sozinho se um
        // adapter estiver fora ou o token não estiver configurado.
        buscarPaineisProduto(id),
      ]);

    const trial = calcularTrialTenant(tenant);
    return {
      id: tenant.id,
      nome: tenant.nome,
      telefone: tenant.telefone,
      whatsapp: tenant.whatsapp,
      endereco: tenant.endereco,
      segmento: tenant.segmento,
      criado_em: tenant.criado_em,
      ativado_em: tenant.ativado_em,
      ativo: tenant.ativo,
      status: tenant.status,
      status_conta: statusContaTenant(tenant),
      status_alterado_em: tenant.status_alterado_em,
      acesso_ate: tenant.acesso_ate,
      cancelado_em: tenant.cancelado_em,
      trial: {
        ativo: trial.trialAtivo,
        inicio: trial.trialInicio,
        fim: trial.trialFim,
        dias_restantes: trial.trialDiasRestantes,
      },
      plano: { chave: tenant.plano, nome: planos.nomeDoPlano(tenant.plano) },
      billing: {
        asaas_customer_id: tenant.asaas_customer_id || null,
        asaas_subscription_id: tenant.asaas_subscription_id || null,
        meio_pagamento: tenant.asaas_meio_pagamento || null,
        cartao_final: tenant.asaas_cartao_final || null,
        cpf_cnpj: tenant.cpf_cnpj || null,
      },
      whatsapp_conectado: !!tenant.meta_phone_number_id,
      meta_phone_number_id: tenant.meta_phone_number_id || null,
      entitlements: {
        modulos,
        limites: Object.fromEntries(
          limitesRes.rows.map((l) => [l.chave, { valor: l.valor, unidade: l.unidade }]),
        ),
      },
      usuarios,
      atividade,
      produtos,
    };
  });

  // ---------------------------------------------------------------------------
  // Ações sensíveis — cada uma numa transação com o AuditEvent (spec §6).
  // ---------------------------------------------------------------------------

  // suspender / reativar: mesma mecânica, muda o status alvo e a ação
  // auditada. reativar sempre volta pra 'ativo' (não restaura trial — decisão
  // de admin = conta ativa).
  async function mutarStatus(request, reply, { novoStatus, acao }) {
    const { id } = request.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, status FROM tenants WHERE id = $1 AND excluido_em IS NULL FOR UPDATE',
        [id],
      );
      const tenant = rows[0];
      if (!tenant) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Empresa não encontrada' });
      }
      if (tenant.status === novoStatus) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: `Empresa já está "${novoStatus}".` });
      }
      const { rows: upd } = await client.query(
        'UPDATE tenants SET status = $2, status_alterado_em = now() WHERE id = $1 RETURNING status',
        [id, novoStatus],
      );
      await registrarAuditoria(client, {
        atorAdminId: request.admin.adminId,
        acao,
        entidadeTipo: 'tenant',
        entidadeId: id,
        tenantId: id,
        antes: { status: tenant.status },
        depois: { status: upd[0].status },
        request,
      });
      await client.query('COMMIT');
      return { status: upd[0].status };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  fastify.post(
    '/admin/api/clientes/:id/suspender',
    { preHandler: [fastify.authenticateAdmin, fastify.requirePermission('clientes:suspend')] },
    (request, reply) => mutarStatus(request, reply, { novoStatus: 'suspenso', acao: 'tenant.suspender' }),
  );

  fastify.post(
    '/admin/api/clientes/:id/reativar',
    { preHandler: [fastify.authenticateAdmin, fastify.requirePermission('clientes:suspend')] },
    (request, reply) => mutarStatus(request, reply, { novoStatus: 'ativo', acao: 'tenant.reativar' }),
  );

  fastify.patch(
    '/admin/api/clientes/:id/plano',
    { preHandler: [fastify.authenticateAdmin, fastify.requirePermission('plano:alterar')] },
    async (request, reply) => {
      const { id } = request.params;
      const novoPlano = (request.body || {}).plano;
      if (!novoPlano || !planos.obterPlano(novoPlano)) {
        return reply.code(400).send({ error: 'Plano inválido.' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id, plano FROM tenants WHERE id = $1 AND excluido_em IS NULL FOR UPDATE',
          [id],
        );
        const tenant = rows[0];
        if (!tenant) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'Empresa não encontrada' });
        }
        if (tenant.plano === novoPlano) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'Empresa já está nesse plano.' });
        }
        await client.query('UPDATE tenants SET plano = $2 WHERE id = $1', [id, novoPlano]);
        await registrarAuditoria(client, {
          atorAdminId: request.admin.adminId,
          acao: 'tenant.alterar_plano',
          entidadeTipo: 'tenant',
          entidadeId: id,
          tenantId: id,
          antes: { plano: tenant.plano },
          depois: { plano: novoPlano },
          request,
        });
        await client.query('COMMIT');
        return { plano: novoPlano, plano_nome: planos.nomeDoPlano(novoPlano) };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // Liga/desliga um módulo (entitlement) de um tenant. Bloqueia desativar
  // módulo obrigatório. Transação com AuditEvent, mesmo padrão das demais.
  fastify.patch(
    '/admin/api/clientes/:id/modulos/:key',
    { preHandler: [fastify.authenticateAdmin, fastify.requirePermission('plano:alterar')] },
    async (request, reply) => {
      const { id, key } = request.params;
      const { ativo } = request.body || {};
      if (typeof ativo !== 'boolean') {
        return reply.code(400).send({ error: 'Campo "ativo" deve ser booleano.' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { rows: tRows } = await client.query(
          'SELECT id FROM tenants WHERE id = $1 AND excluido_em IS NULL FOR UPDATE',
          [id],
        );
        if (!tRows[0]) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'Empresa não encontrada' });
        }

        const { rows: mRows } = await client.query(
          'SELECT key, nome, obrigatorio FROM modulos WHERE key = $1',
          [key],
        );
        const modulo = mRows[0];
        if (!modulo) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'Módulo não encontrado' });
        }
        if (modulo.obrigatorio && !ativo) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: `O módulo "${modulo.nome}" é obrigatório.` });
        }

        const { rows: atualRows } = await client.query(
          'SELECT ativo FROM tenant_modulos WHERE tenant_id = $1 AND modulo_key = $2 FOR UPDATE',
          [id, key],
        );
        const antes = atualRows[0] ? atualRows[0].ativo : false;
        if (antes === ativo) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'Módulo já está nesse estado.' });
        }

        await client.query(
          `INSERT INTO tenant_modulos (tenant_id, modulo_key, ativo) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, modulo_key) DO UPDATE SET ativo = $3`,
          [id, key, ativo],
        );
        await registrarAuditoria(client, {
          atorAdminId: request.admin.adminId,
          acao: ativo ? 'tenant.modulo_ativar' : 'tenant.modulo_desativar',
          entidadeTipo: 'tenant_modulo',
          entidadeId: `${id}:${key}`,
          tenantId: id,
          antes: { modulo: key, ativo: antes },
          depois: { modulo: key, ativo },
          request,
        });
        await client.query('COMMIT');
        return { modulo: key, ativo };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // Editar o cadastro de uma empresa — nome / contato / endereço / segmento.
  // Vinha do admin do Studio (PATCH /admin/api/tenants/:id). Não mexe em
  // status/plano/módulos (esses têm rota própria). `ativo` fica de fora de
  // propósito: o corte de acesso é suspender/reativar.
  fastify.patch(
    '/admin/api/clientes/:id',
    { preHandler: [fastify.authenticateAdmin, fastify.requirePermission('clientes:editar')] },
    async (request, reply) => {
      const { id } = request.params;
      const b = request.body || {};
      if (b.segmento !== undefined && b.segmento !== null && !SEGMENTOS_VALIDOS.includes(b.segmento)) {
        return reply.code(400).send({ error: `segmento deve ser um de: ${SEGMENTOS_VALIDOS.join(', ')}` });
      }
      if (b.nome !== undefined && !String(b.nome).trim()) {
        return reply.code(400).send({ error: 'Nome não pode ficar em branco.' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id, nome, telefone, whatsapp, endereco, segmento FROM tenants WHERE id = $1 AND excluido_em IS NULL FOR UPDATE',
          [id],
        );
        const antes = rows[0];
        if (!antes) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'Empresa não encontrada' });
        }
        const { rows: upd } = await client.query(
          `UPDATE tenants SET
             nome = COALESCE($2, nome),
             telefone = COALESCE($3, telefone),
             whatsapp = COALESCE($4, whatsapp),
             endereco = COALESCE($5, endereco),
             segmento = COALESCE($6, segmento)
           WHERE id = $1
           RETURNING id, nome, telefone, whatsapp, endereco, segmento`,
          [
            id,
            b.nome !== undefined ? String(b.nome).trim() : null,
            b.telefone ?? null,
            b.whatsapp ?? null,
            b.endereco ?? null,
            b.segmento ?? null,
          ],
        );
        await registrarAuditoria(client, {
          atorAdminId: request.admin.adminId,
          acao: 'tenant.editar_cadastro',
          entidadeTipo: 'tenant',
          entidadeId: id,
          tenantId: id,
          antes: {
            nome: antes.nome,
            telefone: antes.telefone,
            whatsapp: antes.whatsapp,
            endereco: antes.endereco,
            segmento: antes.segmento,
          },
          depois: upd[0],
          request,
        });
        await client.query('COMMIT');
        return upd[0];
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );
}

module.exports = { registerAdminClientesRoutes };
