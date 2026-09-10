// Registro de auditoria de ações administrativas sensíveis (spec §6).
// Chamado DENTRO da mesma transação da escrita, com o valor antes e depois —
// `exec` é o pool ou um client de transação (mesma interface `.query`). A
// leitura fica em Sistema › Auditoria (Fase 4).

function dadosDaRequest(request) {
  if (!request || !request.headers) return { ip: null, userAgent: null };
  const fwd = String(request.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return {
    ip: fwd || request.ip || null,
    userAgent: request.headers['user-agent'] || null,
  };
}

async function registrarAuditoria(
  exec,
  {
    atorAdminId = null,
    acao,
    entidadeTipo = null,
    entidadeId = null,
    tenantId = null,
    antes = null,
    depois = null,
    request = null,
  },
) {
  const { ip, userAgent } = dadosDaRequest(request);
  await exec.query(
    `INSERT INTO audit_events
       (ator_admin_id, acao, entidade_tipo, entidade_id, tenant_id, valor_antes, valor_depois, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      atorAdminId,
      acao,
      entidadeTipo,
      entidadeId,
      tenantId,
      antes == null ? null : JSON.stringify(antes),
      depois == null ? null : JSON.stringify(depois),
      ip,
      userAgent,
    ],
  );
}

module.exports = { registrarAuditoria, dadosDaRequest };
