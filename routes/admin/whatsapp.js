// Portal admin — WhatsApp (spec §8). Leitura. Fontes reais nesta leva:
// - números: projeção sobre platform.tenants (meta_phone_number_id) +
//   sinais dos status de mensagem;
// - eventos/logs: whatsapp_webhook_events (o platform já é o único destino
//   cadastrado na Meta e roteia — routes/webhook-whatsapp.js, que agora
//   persiste cada evento);
// - status de mensagem: whatsapp_message_status (derivado do webhook).
// WABAs e quality rating ao vivo entram depois (dependem de chamada à Graph
// API da Meta / gestão de número de verdade).

function registerAdminWhatsappRoutes(fastify, pool) {
  const guard = {
    preHandler: [fastify.authenticateAdmin, fastify.requirePermission('whatsapp:read')],
  };

  fastify.get('/admin/api/whatsapp/resumo', guard, async () => {
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM tenants
          WHERE excluido_em IS NULL AND meta_phone_number_id IS NOT NULL) AS numeros,
        (SELECT count(*)::int FROM whatsapp_webhook_events
          WHERE recebido_em >= now() - interval '24 hours') AS eventos_24h,
        (SELECT count(*)::int FROM whatsapp_message_status
          WHERE status = 'failed' AND ts >= now() - interval '24 hours') AS falhas_24h,
        (SELECT count(*)::int FROM whatsapp_webhook_events
          WHERE tipo = 'mensagem' AND recebido_em >= now() - interval '24 hours') AS mensagens_24h
    `);
    return rows[0];
  });

  fastify.get('/admin/api/whatsapp/numeros', guard, async () => {
    const { rows } = await pool.query(`
      SELECT t.id AS tenant_id, t.nome AS tenant_nome, t.whatsapp, t.meta_phone_number_id,
             t.status AS tenant_status,
             (SELECT max(ts) FROM whatsapp_message_status s
               WHERE s.phone_number_id = t.meta_phone_number_id) AS ultima_atividade,
             (SELECT count(*)::int FROM whatsapp_message_status s
               WHERE s.phone_number_id = t.meta_phone_number_id
                 AND s.status = 'failed' AND s.ts >= now() - interval '24 hours') AS falhas_24h
        FROM tenants t
       WHERE t.excluido_em IS NULL AND t.meta_phone_number_id IS NOT NULL
       ORDER BY t.nome
    `);
    return { numeros: rows };
  });

  fastify.get('/admin/api/whatsapp/eventos', guard, async (request) => {
    const q = request.query || {};
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const cond = [];
    const params = [];
    if (q.pnid) {
      params.push(q.pnid);
      cond.push(`phone_number_id = $${params.length}`);
    }
    if (q.tipo && ['mensagem', 'status', 'outro'].includes(q.tipo)) {
      params.push(q.tipo);
      cond.push(`tipo = $${params.length}`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT id, phone_number_id, tipo, destino, encaminhado, recebido_em
         FROM whatsapp_webhook_events
         ${where}
        ORDER BY recebido_em DESC
        LIMIT $${params.length}`,
      params,
    );
    return { eventos: rows };
  });

  fastify.get('/admin/api/whatsapp/eventos/:id', guard, async (request, reply) => {
    const { rows } = await pool.query(
      'SELECT id, phone_number_id, tipo, destino, encaminhado, recebido_em, payload FROM whatsapp_webhook_events WHERE id = $1',
      [request.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Evento não encontrado' });
    return rows[0];
  });
}

module.exports = { registerAdminWhatsappRoutes };
