// Handoff de sessão entre produtos Kyvvo (Studio/CRM/People) — permite que
// clicar em "trocar de produto" (menu de perfil, ver kyvvo-studio/kyvvo-crm/
// kyvvo-people) entre já autenticado no destino, sem pedir senha de novo.
//
// Cada produto já provou a identidade do usuário com a PRÓPRIA sessão dele
// (JWT local); o platform aqui só serve de correio temporário e confiável
// entre os produtos, autenticado por um segredo compartilhado
// (INTERNAL_HANDOFF_TOKEN, nunca exposto ao navegador) — NUNCA consulta
// usuarios/tenants pra isso, porque nem todo tenant existe no platform ainda
// (corte P3 ainda em andamento: tenants antigos do Studio só existem no
// banco local dele, não em platform.usuarios). Quem chama /internal/handoff
// já manda tenantId/userId/email/nome prontos — o platform só devolve de
// volta pra quem apresentar o código certo, uma única vez.
//
// Em memória (Map), não em tabela: TTL de 30s é curto o bastante pra não
// precisar sobreviver a um restart do processo, e evita migration só pra
// isso. Pior caso de um restart no meio da janela: o usuário clica de novo.
const crypto = require('crypto');
const jwtRs256 = require('../lib/jwt-rs256');

const CODIGO_TTL_MS = 30 * 1000;

function criarArmazenamentoHandoff() {
  const codigos = new Map(); // code -> { payload, expiraEm }

  function limparExpirados(agora = Date.now()) {
    for (const [code, { expiraEm }] of codigos) {
      if (expiraEm < agora) codigos.delete(code);
    }
  }

  // outrosProdutos (bug real em produção, 2026-09-30): quem gera o código já
  // manda pronta a lista de outros produtos do PONTO DE VISTA DO DESTINO
  // (CRM/People não conseguem montar isso sozinhos ao consumir o handoff —
  // não têm o token RS256 do platform naquele momento pra consultar
  // /entitlements como fazem num login normal) — o platform só guarda e
  // devolve de volta, sem entender/validar o formato.
  function criar({ tenantId, userId, email, nome, outrosProdutos }) {
    if (!tenantId || !email) {
      throw new Error('tenantId e email são obrigatórios');
    }
    limparExpirados();
    const code = crypto.randomBytes(24).toString('hex');
    codigos.set(code, {
      payload: { tenantId, userId: userId || null, email, nome: nome || null, outrosProdutos: outrosProdutos || [] },
      expiraEm: Date.now() + CODIGO_TTL_MS,
    });
    return code;
  }

  // Uso único: o código já sai da memória na primeira consulta, mesmo se o
  // resultado não for usado (evita replay).
  function verificar(code) {
    const entrada = code && codigos.get(code);
    if (code) codigos.delete(code);
    if (!entrada || entrada.expiraEm < Date.now()) return null;
    return entrada.payload;
  }

  return { criar, verificar, _codigos: codigos };
}

function tokenInternoValido(headerRecebido, tokenEsperado) {
  return !!headerRecebido && !!tokenEsperado && headerRecebido === tokenEsperado;
}

function registerHandoffRoutes(fastify, pool) {
  const armazenamento = criarArmazenamentoHandoff();

  fastify.decorate('autenticarInterno', async (request, reply) => {
    if (!tokenInternoValido(request.headers['x-internal-token'], process.env.INTERNAL_HANDOFF_TOKEN)) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
  });

  fastify.post('/internal/handoff', { preHandler: [fastify.autenticarInterno] }, async (request, reply) => {
    let code;
    try {
      code = armazenamento.criar(request.body || {});
    } catch (erro) {
      return reply.code(400).send({ error: erro.message });
    }
    return { code };
  });

  // `emitirToken` (opt-in, usado pelos 3 receptores de handoff — /sso do
  // Studio, /people/sso, /crm/sso) — além do payload de sempre, busca
  // token_version em usuarios/tenants (fonte canônica de identidade, mesmo
  // quando o produto chamador tem seu próprio banco de negócio separado) e
  // devolve um `token` RS256 pronto pra sessão, pra ninguém mais precisar
  // assinar nada localmente (nenhum dos 3 tem mais @fastify/jwt depois do
  // corte de sessão — e o /sso do Studio chamava um fastify.jwt.sign que já
  // nem existia mais ali, 500 em produção; corrigido usando isto).
  fastify.post('/internal/handoff/verify', { preHandler: [fastify.autenticarInterno] }, async (request, reply) => {
    const { code, emitirToken } = request.body || {};
    const payload = armazenamento.verificar(code);
    if (!payload) {
      return reply.code(404).send({ error: 'Código inválido ou expirado' });
    }
    if (!emitirToken) return payload;

    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.token_version
       FROM usuarios u
       WHERE u.tenant_id = $1 AND u.email = $2`,
      [payload.tenantId, payload.email]
    );
    const usuario = rows[0];
    if (!usuario) {
      return reply.code(404).send({ error: 'Usuário não encontrado' });
    }
    const token = jwtRs256.sign({
      userId: usuario.user_id,
      tenantId: payload.tenantId,
      email: payload.email,
      tokenVersion: usuario.token_version,
    });
    return { ...payload, token };
  });
}

module.exports = { registerHandoffRoutes, criarArmazenamentoHandoff, tokenInternoValido, CODIGO_TTL_MS };
