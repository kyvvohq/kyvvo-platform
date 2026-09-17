// Auth + recuperação de senha + cadastro self-service — portado de
// kyvvo/server/panel/routes/auth.js.
//
// Rotas idênticas em path e contrato (o front do Studio e o backend do People
// não mudam de URL): POST /api/auth/{login,logout,esqueci-senha,
// redefinir-senha,register,verify-token,resend-token}, GET
// /api/auth/people/acesso. Novo aqui: POST /api/auth/refresh (o access token
// agora dura 15 min).
//
// Diferença de comportamento vs. o original: o token é assinado em RS256
// (lib/jwt-rs256.js) com TTL de 15 min, no lugar do HS256 `7d` do
// @fastify/jwt. Claims idênticos: { userId, tenantId, email, tokenVersion }.
//
const bcrypt = require('bcryptjs');
const tokenService = require('../token-service');
const configSistema = require('../lib/configuracoes-sistema');
const { EMAIL_REGEX, SENHA_REGEX } = require('../lib/validadores');
const { normalizarWhatsapp } = require('../lib/whatsapp');
const jwtRs256 = require('../lib/jwt-rs256');

const REENVIO_COOLDOWN_SEGUNDOS = 60;

// Módulos liberados automaticamente no trial (US77/CA09).
const MODULOS_TRIAL = ['agenda_inteligente', 'financeiro', 'dashboards'];
// Cadastro pelo People (produto:'people' no body) — produtos diferentes no
// mesmo serviço de auth, ver [[project_kyvvo_people]]. Sem trial (decisão de
// produto do People, 2026-08-30): a conta nasce 'ativo' (a CONTA existe e é
// válida — não confundir com "assinatura ativa" do People, que é outra
// tabela, em outro serviço); só o módulo 'people' é ligado, nunca os módulos
// do Studio. O bloqueio de funcionalidades até fechar uma licença é feito no
// kyvvo-people (checa a própria tabela `assinaturas`), não aqui.
const MODULOS_PEOPLE = ['people'];
// Mesmo padrão pro CRM (produto:'crm'). Plano/preço/trial do CRM ainda não
// foram decididos (doc de instruções do projeto, seção 11) — por ora a conta
// nasce 'ativo' sem trial, igual ao People; reveja se o CRM ganhar um modelo
// de cobrança próprio (ver kyvvo-crm/docs/DECISOES-PENDENTES.md #2).
const MODULOS_CRM = ['crm'];
const TERMOS_VERSAO = '2026-07-22';
const PRIVACIDADE_VERSAO = '2026-07-22';

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

    // Best-effort: Kyvvo Admin mostra isso na tela de Usuários (coluna
    // "Último login", ao lado de "Cadastrado em"). Não bloqueia o login se
    // falhar — não faz parte do BEGIN/COMMIT de nada, é só telemetria.
    pool.query('UPDATE usuarios SET ultimo_login_em = now() WHERE id = $1', [usuario.id])
      .catch((erro) => fastify.log.warn({ erro: erro.message, userId: usuario.id }, 'Falha ao gravar ultimo_login_em'));

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

  // Mesma checagem pro Kyvvo CRM.
  fastify.get(
    '/api/auth/crm/acesso',
    { preHandler: [fastify.authenticate, fastify.requireModulo('crm')] },
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

  fastify.post('/api/auth/register', async (request, reply) => {
    const {
      nome_empresa: nomeEmpresa,
      nome_responsavel: nomeResponsavel,
      email,
      senha,
      segmento_id: segmentoIdBruto,
      telefone: telefoneBruto,
      whatsapp: whatsappBruto,
      aceite_termos: aceiteTermosBruto,
      aceita_marketing: aceitaMarketingBruto,
      plano_slug: planoSlugBruto,
      produto: produtoBruto,
    } = request.body || {};
    const produto = produtoBruto === 'people' || produtoBruto === 'crm' ? produtoBruto : 'studio';

    const nomeEmpresaLimpo = (nomeEmpresa || '').trim();
    const nomeLimpo = (nomeResponsavel || '').trim();
    const emailLimpo = (email || '').toLowerCase().trim();

    if (nomeEmpresaLimpo.length < 2) {
      return reply.code(400).send({ error: 'Informe o nome da empresa.' });
    }
    if (nomeLimpo.length < 2) {
      return reply.code(400).send({ error: 'Informe o nome do responsável.' });
    }
    if (!EMAIL_REGEX.test(emailLimpo)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }
    if (!SENHA_REGEX.test(senha || '')) {
      return reply.code(400).send({
        error: 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      });
    }
    let segmentoId = null;
    if (segmentoIdBruto !== undefined && segmentoIdBruto !== null && segmentoIdBruto !== '') {
      segmentoId = parseInt(segmentoIdBruto, 10);
      if (!Number.isInteger(segmentoId)) {
        return reply.code(400).send({ error: 'Selecione um segmento válido.' });
      }
    }
    const telefone = normalizarWhatsapp(telefoneBruto);
    if (!telefone) {
      return reply.code(400).send({ error: 'Digite um telefone válido com DDD.' });
    }
    const whatsapp = normalizarWhatsapp(whatsappBruto);
    if (!whatsapp) {
      return reply.code(400).send({ error: 'Digite um número de WhatsApp válido com DDD.' });
    }
    const aceiteTermos = aceiteTermosBruto === true;
    if (!aceiteTermos) {
      return reply.code(422).send({
        error: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade para criar a conta.',
        erros: { aceite_termos: 'Aceite obrigatório.' },
      });
    }
    const aceitaMarketing = aceitaMarketingBruto === true;

    const { rows: emailRows } = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [emailLimpo]);
    if (emailRows.length > 0) {
      return reply.code(409).send({ error: 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.' });
    }
    const { rows: whatsappRows } = await pool.query('SELECT 1 FROM tenants WHERE whatsapp = $1', [whatsapp]);
    if (whatsappRows.length > 0) {
      return reply.code(409).send({ error: 'Este número de WhatsApp já está associado a uma conta.' });
    }
    let segmentoSlug = null;
    if (segmentoId !== null) {
      const { rows: segmentoRows } = await pool.query(
        'SELECT slug FROM segmentos WHERE id = $1 AND ativo = true',
        [segmentoId]
      );
      if (!segmentoRows[0]) {
        return reply.code(400).send({ error: 'Selecione um segmento válido.' });
      }
      segmentoSlug = segmentoRows[0].slug;
    }
    // Onboarding por segmento é conceito do Studio (US82) — o People não tem
    // segmento nem etapa de onboarding, então nunca fica "pendente".
    const onboardingPendente = produto === 'studio' && segmentoId === null;

    let planoChave = null;
    let planoSlugResolvido = null;
    const planoSlugLimpo = typeof planoSlugBruto === 'string' ? planoSlugBruto.trim() : '';
    if (planoSlugLimpo) {
      const { rows: planoRows } = await pool.query(
        'SELECT chave, slug FROM planos WHERE slug = $1 OR chave = $1',
        [planoSlugLimpo]
      );
      if (!planoRows[0]) {
        return reply.code(422).send({ error: 'Plano selecionado inválido.' });
      }
      planoChave = planoRows[0].chave;
      planoSlugResolvido = planoRows[0].slug;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // People/CRM não têm trial (decisão de produto pro People, 2026-08-30;
      // mesma lógica aplicada ao CRM por ora — ver MODULOS_CRM acima e
      // kyvvo-crm/docs/DECISOES-PENDENTES.md #2 se isso mudar): status nasce
      // 'ativo' e sem trial_expires_at — o bloqueio até fechar uma licença é
      // responsabilidade do serviço do produto (assinatura própria), não
      // deste `status` (que aqui é só "a conta existe").
      const semTrial = produto === 'people' || produto === 'crm';
      const statusInicial = semTrial ? 'ativo' : 'trial';
      const trialExpira = semTrial
        ? null
        : new Date(Date.now() + configSistema.config.trialDias * 24 * 60 * 60 * 1000).toISOString();
      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (nome, telefone, whatsapp, segmento, segmento_id, plano, status, trial_expires_at, onboarding_pendente)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [nomeEmpresaLimpo, telefone, whatsapp, segmentoSlug, segmentoId, semTrial ? planoChave : (planoChave || 'trial'), statusInicial, trialExpira, onboardingPendente]
      );
      const tenantId = tenantRows[0].id;

      const modulosIniciais = produto === 'people' ? MODULOS_PEOPLE : produto === 'crm' ? MODULOS_CRM : MODULOS_TRIAL;
      await client.query(
        `INSERT INTO tenant_modulos (tenant_id, modulo_key, ativo)
         SELECT $1, key, true FROM modulos WHERE key = ANY($2::text[])
         ON CONFLICT (tenant_id, modulo_key) DO NOTHING`,
        [tenantId, modulosIniciais]
      );

      const hash = await bcrypt.hash(senha, 10);
      const { rows: usuarioRows } = await client.query(
        `INSERT INTO usuarios (tenant_id, email, senha_hash, nome, email_verified)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id, token_version`,
        [tenantId, emailLimpo, hash, nomeLimpo]
      );
      const usuarioId = usuarioRows[0].id;

      await client.query(
        `INSERT INTO consentimentos_cadastro (tenant_id, termos_versao, privacidade_versao, aceita_marketing, ip)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, TERMOS_VERSAO, PRIVACIDADE_VERSAO, aceitaMarketing, request.ip]
      );

      const codigo = await tokenService.criarToken(client, { userId: usuarioId, tipo: 'email_verificacao' });

      await client.query('COMMIT');

      tokenService.enviarPorCanais({ token: codigo, email: emailLimpo, whatsapp, nome: nomeLimpo });

      const token = assinarAcesso({
        userId: usuarioId,
        tenantId,
        email: emailLimpo,
        tokenVersion: usuarioRows[0].token_version,
      });

      reply.code(201);
      return {
        token,
        nome: nomeLimpo,
        email: emailLimpo,
        email_verified: false,
        email_mascarado: tokenService.mascararEmail(emailLimpo),
        plano_slug: planoSlugResolvido,
        segmento: segmentoSlug,
        onboarding_pendente: onboardingPendente,
      };
    } catch (erro) {
      await client.query('ROLLBACK');
      if (erro.code === '23505') {
        const msg = /whatsapp/i.test(erro.constraint || '')
          ? 'Este número de WhatsApp já está associado a uma conta.'
          : 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.';
        return reply.code(409).send({ error: msg });
      }
      throw erro;
    } finally {
      client.release();
    }
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
