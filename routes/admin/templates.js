// Portal admin — Templates de disparo (spec §9). CRUD + estados +
// versionamento + submissão à Meta (stub) + teste de renderização.
// Filtro obrigatório por produto no frontend.

const { renderizar } = require('../../lib/templates');
const { registrarAuditoria } = require('../../lib/auditoria');

const PRODUTOS = ['studio', 'people', 'leads', 'crm'];
const CATEGORIAS = ['utility', 'marketing', 'authentication'];
const ESTADOS_MANUAIS = ['em_analise', 'aprovado', 'rejeitado', 'arquivado'];
const EDITAVEL = ['rascunho', 'rejeitado'];

function snapshot(t) {
  return {
    nome_interno: t.nome_interno,
    meta_nome: t.meta_nome,
    categoria: t.categoria,
    idioma: t.idioma,
    corpo: t.corpo,
    variaveis: t.variaveis,
    descricao_uso: t.descricao_uso,
  };
}

function registerAdminTemplatesRoutes(fastify, pool) {
  const ler = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('template:read')],
  };
  const escrever = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('template:write')],
  };

  fastify.get('/admin/api/templates', ler, async (request) => {
    const q = request.query || {};
    const cond = [];
    const params = [];
    if (q.produto && PRODUTOS.includes(q.produto)) {
      params.push(q.produto);
      cond.push(`produto = $${params.length}`);
    }
    if (q.estado) {
      params.push(q.estado);
      cond.push(`estado = $${params.length}`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, produto, nome_interno, categoria, idioma, estado, meta_status, meta_sync_em,
              versao, atualizado_em
         FROM message_templates ${where} ORDER BY atualizado_em DESC`,
      params,
    );
    return { templates: rows };
  });

  fastify.get('/admin/api/templates/:id', ler, async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM message_templates WHERE id = $1', [
      request.params.id,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: 'Template não encontrado' });
    const { rows: versoes } = await pool.query(
      `SELECT v.versao, v.criado_em, a.nome AS autor
         FROM message_template_versions v
         LEFT JOIN admin_users a ON a.id = v.autor_admin_id
        WHERE v.template_id = $1 ORDER BY v.versao DESC`,
      [request.params.id],
    );
    return { ...rows[0], versoes };
  });

  fastify.post('/admin/api/templates', escrever, async (request, reply) => {
    const b = request.body || {};
    if (!PRODUTOS.includes(b.produto)) return reply.code(400).send({ error: 'produto inválido' });
    if (!b.nome_interno || !b.nome_interno.trim()) {
      return reply.code(400).send({ error: 'nome_interno é obrigatório' });
    }
    if (!b.corpo || !b.corpo.trim()) return reply.code(400).send({ error: 'corpo é obrigatório' });
    const categoria = CATEGORIAS.includes(b.categoria) ? b.categoria : 'utility';
    try {
      const { rows } = await pool.query(
        `INSERT INTO message_templates
           (produto, nome_interno, meta_nome, categoria, idioma, corpo, variaveis, descricao_uso, autor_admin_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          b.produto,
          b.nome_interno.trim(),
          b.meta_nome || null,
          categoria,
          b.idioma || 'pt_BR',
          b.corpo,
          JSON.stringify(Array.isArray(b.variaveis) ? b.variaveis : []),
          b.descricao_uso || null,
          request.admin.adminId,
        ],
      );
      reply.code(201);
      return rows[0];
    } catch (e) {
      if (e.code === '23505') {
        return reply.code(409).send({ error: 'Já existe um template com esse nome interno nesse produto.' });
      }
      throw e;
    }
  });

  fastify.patch('/admin/api/templates/:id', escrever, async (request, reply) => {
    const b = request.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT * FROM message_templates WHERE id = $1 FOR UPDATE',
        [request.params.id],
      );
      const tpl = rows[0];
      if (!tpl) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Template não encontrado' });
      }
      if (!EDITAVEL.includes(tpl.estado)) {
        await client.query('ROLLBACK');
        return reply
          .code(409)
          .send({ error: `Template em "${tpl.estado}" não é editável. Arquive e crie outro.` });
      }

      await client.query(
        `INSERT INTO message_template_versions (template_id, versao, snapshot, autor_admin_id)
         VALUES ($1, $2, $3, $4)`,
        [tpl.id, tpl.versao, JSON.stringify(snapshot(tpl)), request.admin.adminId],
      );

      const { rows: upd } = await client.query(
        `UPDATE message_templates SET
           meta_nome = COALESCE($2, meta_nome),
           categoria = COALESCE($3, categoria),
           idioma = COALESCE($4, idioma),
           corpo = COALESCE($5, corpo),
           variaveis = COALESCE($6, variaveis),
           descricao_uso = COALESCE($7, descricao_uso),
           versao = versao + 1,
           estado = 'rascunho',
           meta_status = null,
           meta_motivo_rejeicao = null,
           atualizado_em = now()
         WHERE id = $1 RETURNING *`,
        [
          tpl.id,
          b.meta_nome ?? null,
          CATEGORIAS.includes(b.categoria) ? b.categoria : null,
          b.idioma ?? null,
          b.corpo ?? null,
          b.variaveis ? JSON.stringify(b.variaveis) : null,
          b.descricao_uso ?? null,
        ],
      );
      await client.query('COMMIT');
      return upd[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // Stub: marca "enviado". Submissão real à Graph API da Meta entra quando o
  // escopo de Tech Provider estiver confirmado.
  fastify.post('/admin/api/templates/:id/submeter', escrever, async (request, reply) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, estado FROM message_templates WHERE id = $1 FOR UPDATE',
        [request.params.id],
      );
      const tpl = rows[0];
      if (!tpl) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Template não encontrado' });
      }
      if (!EDITAVEL.includes(tpl.estado)) {
        await client.query('ROLLBACK');
        return reply
          .code(409)
          .send({ error: `Só dá pra submeter de rascunho/rejeitado (está em "${tpl.estado}").` });
      }
      const { rows: upd } = await client.query(
        `UPDATE message_templates
            SET estado = 'enviado', meta_status = 'PENDING_STUB', meta_sync_em = now()
          WHERE id = $1 RETURNING *`,
        [tpl.id],
      );
      await registrarAuditoria(client, {
        atorAdminId: request.admin.adminId,
        acao: 'template.submeter',
        entidadeTipo: 'message_template',
        entidadeId: tpl.id,
        antes: { estado: tpl.estado },
        depois: { estado: 'enviado' },
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
  });

  // Sincroniza à mão o veredito da Meta (até a integração real existir).
  fastify.post('/admin/api/templates/:id/estado', escrever, async (request, reply) => {
    const novo = (request.body || {}).estado;
    if (!ESTADOS_MANUAIS.includes(novo)) {
      return reply.code(400).send({ error: `estado deve ser um de: ${ESTADOS_MANUAIS.join(', ')}` });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, estado FROM message_templates WHERE id = $1 FOR UPDATE',
        [request.params.id],
      );
      const tpl = rows[0];
      if (!tpl) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Template não encontrado' });
      }
      const motivo = novo === 'rejeitado' ? (request.body || {}).motivo || null : null;
      const { rows: upd } = await client.query(
        `UPDATE message_templates
            SET estado = $2, meta_motivo_rejeicao = $3, meta_sync_em = now()
          WHERE id = $1 RETURNING *`,
        [tpl.id, novo, motivo],
      );
      await registrarAuditoria(client, {
        atorAdminId: request.admin.adminId,
        acao: 'template.estado',
        entidadeTipo: 'message_template',
        entidadeId: tpl.id,
        antes: { estado: tpl.estado },
        depois: { estado: novo },
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
  });

  // Preview: renderiza o corpo com os exemplos (ou com variáveis do body).
  fastify.post('/admin/api/templates/:id/testar', ler, async (request, reply) => {
    const { rows } = await pool.query(
      'SELECT corpo, variaveis FROM message_templates WHERE id = $1',
      [request.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Template não encontrado' });
    const body = request.body || {};
    const vars = Array.isArray(body.variaveis) ? body.variaveis : rows[0].variaveis;
    return { preview: renderizar(rows[0].corpo, vars) };
  });
}

module.exports = { registerAdminTemplatesRoutes };
