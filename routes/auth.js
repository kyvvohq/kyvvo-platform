// Auth + recuperação de senha — portado de kyvvo/server/panel/routes/auth.js.
//
// Rotas idênticas em path e contrato (o front do Studio e o backend do People
// não mudam de URL): POST /api/auth/{login,logout,esqueci-senha,
// redefinir-senha,verify-token,resend-token}, GET /api/auth/people/acesso.
// Novo aqui: POST /api/auth/refresh (o access token agora dura 15 min).
//
// Diferença de comportamento vs. o original: o token é assinado em RS256
// (lib/jwt-rs256.js) com TTL de 15 min, no lugar do HS256 `7d` do
// @fastify/jwt. Claims idênticos: { userId, tenantId, email, tokenVersion }.
//
// FORA desta leva (entra quando o cadastro self-service for portado, junto de
// segmentos/consentimentos_cadastro/onboarding): POST /api/auth/register.
// O Studio segue servindo /api/auth/register pelo painel até lá.

const bcrypt = require('bcryptjs');
const tokenService = require('../token-service');
const configSistema = require('../lib/configuracoes-sistema');
const { EMAIL_REGEX, SENHA_REGEX } = require('../lib/validadores');
const jwtRs256 = require('../lib/jwt-rs256');

const REENVIO_COOLDOWN_SEGUNDOS = 60;

function assinarAcesso(usuario) {
  return jwtRs256.sign({
    userId: usuario.id ?? usuario.userId,
    tenantId: usuario.tenant_id ?? usuario.tenantId,
    email: usuario.email,
    tokenVersion: usuario.token_version ?? usuario.tokenVersion,
  });
}

function registerAuthRoutes(fastify, pool) {
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.tenant_id, u.email, u.senha_hash, u.nome, u.token_version, u.email_verified,
              u.role, u.ativo AS usuario_ativo, t.ativo AS tenant_ativo
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );
    const usuario = rows[0];
    if (!usuario) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    if (!usuario.tenant_ativo) {
      return reply.code(403).send({ error: 'Acesso desativado. Fale com o suporte da Kyvvo.' });
    }
    if (!usuario.usuario_ativo) {
      return reply.code(403).send({ error: 'Acesso desativado. Fale com o administrador da sua equipe.' });
    }

    const token = assinarAcesso(usuario);

    return { token, nome: usuario.nome, email: usuario.email, email_verified: usuario.email_verified, role: usuario.role };
  });

  // Renova o access token (TTL 15 min). Aceita um token ainda válido ou
  // vencido há pouco; re-checa token_version e `ativo` no banco (um logout ou
  // troca de senha feito nesse meio-tempo invalida a renovação).
  fastify.post('/api/auth/refresh', async (request, reply) => {
    const { token } = request.body || {};
    if (!token) {
      return reply.code(400).send({ error: 'Token ausente' });
    }
    let payload;
    try {
      payload = jwtRs256.verify(token, { ignoreExpiration: true });
    } catch (err) {
      return reply.code(401).send({ error: 'Token inválido' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.tenant_id, u.email, u.token_version, u.ativo AS usuario_ativo, t.ativo AS tenant_ativo
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [payload.userId]
    );
    const usuario = rows[0];
    if (!usuario || usuario.token_version !== payload.tokenVersion) {
      return reply.code(401).send({ error: 'Sessão expirada. Faça login novamente.' });
    }
    if (!usuario.usuario_ativo || !usuario.tenant_ativo) {
      return reply.code(401).send({ error: 'Acesso desativado.' });
    }

    return { token: assinarAcesso(usuario) };
  });

  // Checagem de acesso ao módulo "people" usada pelo backend do Kyvvo People
  // logo após o login: só confirma se o tenant do token pode entrar.
  fastify.get(
    '/api/auth/people/acesso',
    { preHandler: [fastify.authenticate, fastify.requireModulo('people')] },
    async (request) => ({ tenantId: request.user.tenantId })
  );

  // Invalida o token atual (e todos os anteriores) incrementando token_version
  // — é a comparação em `authenticate` que faz o logout ter efeito imediato no
  // servidor, não só no cliente.
  fastify.post('/api/auth/logout', { preHandler: [fastify.authenticate] }, async (request) => {
    await pool.query(
      'UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1',
      [request.user.userId]
    );
    return { ok: true };
  });

  // Solicita o código de recuperação por e-mail. Sem preHandler: quem esqueceu
  // a senha não tem sessão. Resposta sempre genérica (não revela se o e-mail
  // existe).
  fastify.post('/api/auth/esqueci-senha', async (request, reply) => {
    const email = ((request.body || {}).email || '').toLowerCase().trim();
    if (!EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }

    const respostaGenerica = {
      ok: true,
      message: 'Se este e-mail estiver cadastrado, enviamos um código de recuperação.',
    };

    const { rows } = await pool.query('SELECT id, nome FROM usuarios WHERE email = $1', [email]);
    const usuario = rows[0];
    if (!usuario) {
      return respostaGenerica;
    }

    const { rows: ultimoRows } = await pool.query(
      `SELECT criado_em FROM tokens_validacao
       WHERE user_id = $1 AND tipo = 'recuperacao_senha'
       ORDER BY criado_em DESC LIMIT 1`,
      [usuario.id]
    );
    const emCooldown = ultimoRows[0]
      && Date.now() - new Date(ultimoRows[0].criado_em).getTime() < REENVIO_COOLDOWN_SEGUNDOS * 1000;
    if (emCooldown) {
      return respostaGenerica;
    }

    const codigo = await tokenService.criarToken(pool, { userId: usuario.id, tipo: 'recuperacao_senha' });
    tokenService.enviarPorCanais({ token: codigo, canais: ['email'], email, nome: usuario.nome });

    return respostaGenerica;
  });

  // Confirma o código de 6 dígitos e define a nova senha.
  fastify.post('/api/auth/redefinir-senha', async (request, reply) => {
    const { email: emailBruto, token: tokenBruto, senha } = request.body || {};
    const email = (emailBruto || '').toLowerCase().trim();
    const codigo = String(tokenBruto || '').trim();

    if (!EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }
    if (!/^\d{6}$/.test(codigo)) {
      return reply.code(400).send({ error: 'Código inválido ou expirado. Solicite um novo.' });
    }
    if (!SENHA_REGEX.test(senha || '')) {
      return reply.code(400).send({
        error: 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      });
    }

    const mensagens = {
      nao_encontrado: 'Código inválido ou expirado. Solicite um novo.',
      expirado: 'Código expirado. Solicite um novo.',
      bloqueado: 'Número máximo de tentativas atingido. Solicite um novo código.',
      incorreto: 'Código incorreto. Tente novamente.',
    };

    const { rows } = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    const usuario = rows[0];
    if (!usuario) {
      return reply.code(400).send({ error: mensagens.nao_encontrado });
    }

    const { valido, motivo } = await tokenService.validate({
      userId: usuario.id,
      tipo: 'recuperacao_senha',
      token: codigo,
    });
    if (!valido) {
      return reply.code(400).send({ error: mensagens[motivo] || mensagens.incorreto });
    }

    const hash = await bcrypt.hash(senha, 10);
    await pool.query(
      'UPDATE usuarios SET senha_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [hash, usuario.id]
    );

    return { ok: true, message: 'Senha redefinida com sucesso. Faça login com a nova senha.' };
  });

  // Valida o token de 6 dígitos e ativa o e-mail. Autenticado: o usuário já
  // está logado desde o cadastro (ou desde o login sem validação).
  fastify.post('/api/auth/verify-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, tenantId } = request.user;
    const codigo = String((request.body || {}).token || '').trim();

    if (!/^\d{6}$/.test(codigo)) {
      return reply.code(400).send({ error: 'Código incorreto. Tente novamente.' });
    }

    const { valido, motivo } = await tokenService.validate({ userId, tipo: 'email_verificacao', token: codigo });
    if (!valido) {
      const mensagens = {
        nao_encontrado: 'Nenhum código pendente. Solicite um novo.',
        expirado: 'Código expirado. Solicite um novo.',
        bloqueado: 'Número máximo de tentativas atingido. Solicite um novo código.',
        incorreto: 'Código incorreto. Tente novamente.',
      };
      return reply.code(400).send({ error: mensagens[motivo] || mensagens.incorreto });
    }

    await pool.query('UPDATE usuarios SET email_verified = true WHERE id = $1', [userId]);
    await pool.query('UPDATE tenants SET ativado_em = COALESCE(ativado_em, now()) WHERE id = $1', [tenantId]);

    return { ok: true, message: 'E-mail verificado! Seu trial de 14 dias está ativo.' };
  });

  // Reenvio de token: novo token, invalida o anterior, cooldown de 60s e
  // limite de 5 por hora.
  fastify.post('/api/auth/resend-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, email } = request.user;

    const { rows: contagem } = await pool.query(
      `SELECT
         COUNT(*)::int AS na_hora,
         MAX(criado_em) AS ultimo
       FROM tokens_validacao
       WHERE user_id = $1 AND tipo = 'email_verificacao' AND criado_em > now() - interval '1 hour'`,
      [userId]
    );
    if (contagem[0].na_hora >= configSistema.config.maxReenviosHora) {
      return reply.code(429).send({ error: 'Limite de reenvios atingido. Tente novamente mais tarde.' });
    }
    if (contagem[0].ultimo && Date.now() - new Date(contagem[0].ultimo).getTime() < REENVIO_COOLDOWN_SEGUNDOS * 1000) {
      return reply.code(429).send({ error: 'Aguarde alguns segundos antes de solicitar um novo código.' });
    }

    const { rows: tenantRows } = await pool.query(
      `SELECT t.whatsapp FROM usuarios u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [userId]
    );
    const whatsapp = tenantRows[0] ? tenantRows[0].whatsapp : null;

    const client = await pool.connect();
    let codigo;
    try {
      await client.query('BEGIN');
      codigo = await tokenService.criarToken(client, { userId, tipo: 'email_verificacao' });
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    tokenService.enviarPorCanais({ token: codigo, email, whatsapp: whatsapp || undefined });

    return { ok: true };
  });
}

module.exports = { registerAuthRoutes };
