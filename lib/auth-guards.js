// Guards de sessão — portados de kyvvo/server/panel/index.js (decorators
// `authenticate` / `requireModulo` / `requireAdmin`).
//
// Única diferença de comportamento vs. o original: a verificação do token é
// RS256 local (lib/jwt-rs256.js) no lugar de `request.jwtVerify()` HS256 do
// @fastify/jwt. O resto — lookup em banco a cada request pra `token_version`
// (logout imediato), `role` (troca de perfil imediata) e bloqueio por
// assinatura (calcularBloqueioAssinatura, mesma fonte de verdade) — é igual.
//
// As whitelists de rota são as mesmas do painel, recortadas pras rotas que
// este serviço expõe.

const jwtRs256 = require('./jwt-rs256');
const { calcularBloqueioAssinatura, BLOQUEIO_MENSAGENS } = require('./trial-conta');
const { registrarEventoTrialExpiradoUmaVez } = require('./eventos');

function registrarGuards(fastify, pool) {
  // Rotas que um usuário sem e-mail verificado ainda pode acessar — pra
  // completar a verificação, pedir reenvio ou sair. Checado dentro de
  // `authenticate` (não num preHandler à parte) pra o bloqueio nunca depender
  // de alguém lembrar de encadear a checagem rota a rota.
  const ROTAS_LIVRES_SEM_VERIFICACAO = new Set([
    'POST /api/auth/logout',
    'POST /api/auth/verify-token',
    'POST /api/auth/resend-token',
  ]);

  // Acesso limitado (trial vencido/inadimplente/suspenso/cancelado): GET
  // nunca é bloqueado; só escrita fora desta whitelist. `logout` é a única
  // escrita deste serviço que precisa continuar livre.
  const ROTAS_LIVRES_SEM_ASSINATURA = new Set([
    'POST /api/auth/logout',
  ]);

  fastify.decorate('authenticate', async (request, reply) => {
    let payload;
    try {
      const header = request.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : header;
      payload = jwtRs256.verify(token);
    } catch (err) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
    request.user = {
      userId: payload.userId,
      tenantId: payload.tenantId,
      email: payload.email,
      tokenVersion: payload.tokenVersion,
    };

    const { rows } = await pool.query(
      `SELECT u.token_version, u.email_verified, u.role, u.ativo,
              t.status AS tenant_status, t.ativado_em, t.status_alterado_em, t.acesso_ate
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [request.user.userId]
    );
    const usuario = rows[0];
    if (!usuario || usuario.token_version !== request.user.tokenVersion) {
      return reply.code(401).send({ error: 'Sessão expirada. Faça login novamente.' });
    }
    if (!usuario.ativo) {
      return reply.code(401).send({ error: 'Acesso desativado. Fale com o administrador da sua equipe.' });
    }
    request.user.role = usuario.role;

    const rotaAtual = `${request.method} ${request.routeOptions.url}`;
    if (!usuario.email_verified) {
      if (!ROTAS_LIVRES_SEM_VERIFICACAO.has(rotaAtual)) {
        return reply.code(403).send({ error: 'Confirme seu cadastro para continuar. Verifique seu e-mail ou WhatsApp.' });
      }
      return;
    }

    const bloqueioMotivo = calcularBloqueioAssinatura({
      status: usuario.tenant_status,
      ativado_em: usuario.ativado_em,
      status_alterado_em: usuario.status_alterado_em,
      acesso_ate: usuario.acesso_ate,
    });
    if (bloqueioMotivo) {
      if (bloqueioMotivo === 'trial_expirado') {
        await registrarEventoTrialExpiradoUmaVez(request.user.tenantId);
      }
      if (request.method !== 'GET' && !ROTAS_LIVRES_SEM_ASSINATURA.has(rotaAtual)) {
        return reply.code(403).send({
          error: BLOQUEIO_MENSAGENS[bloqueioMotivo],
          bloqueio: bloqueioMotivo,
        });
      }
    }
  });

  // requireModulo('people') devolve um preHandler que barra a rota com 403 se
  // o tenant não tiver o módulo ativo em tenant_modulos. Encadear sempre
  // depois de `authenticate`.
  fastify.decorate('requireModulo', (moduloKey) => async (request, reply) => {
    const { tenantId } = request.user || {};
    if (!tenantId) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
    const { rows } = await pool.query(
      'SELECT 1 FROM tenant_modulos WHERE tenant_id = $1 AND modulo_key = $2 AND ativo LIMIT 1',
      [tenantId, moduloKey]
    );
    if (rows.length === 0) {
      return reply.code(403).send({
        error: `Módulo "${moduloKey}" não está ativo para este salão.`,
      });
    }
  });

  // Restringe rotas ao perfil administrador. Encadear sempre depois de
  // `authenticate`, que já resolve request.user.role a partir do banco.
  fastify.decorate('requireAdmin', async (request, reply) => {
    if (request.user.role !== 'administrador') {
      return reply.code(403).send({ error: 'Ação restrita ao administrador da conta.' });
    }
  });
}

module.exports = { registrarGuards };
