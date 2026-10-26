// Pagamentos do CRM — proxy interno, não rota pública RS256 (diferente de
// routes/pagamentos.js, que serve o Studio). O CRM não guarda o token RS256
// do platform além do instante do login (kyvvo-crm/index.js: assina seu
// próprio JWT local pra sessão) — por isso essas rotas são autenticadas por
// segredo compartilhado (X-Internal-Token), mesmo padrão de
// routes/handoff.js (/internal/handoff) e routes/email.js
// (/internal/email/send). O CRM já prova a identidade do usuário com a
// PRÓPRIA sessão dele; aqui só repassa o tenantId já validado.
//
// Reaproveita tenants/planos tal como estão — tenants do CRM já existem em
// platform.tenants (POST /api/auth/register com produto:'crm'), e planos já
// tem 3 chaves 'crm_*' (db/009_crm_planos.sql). Sem rota de webhook nova: o
// POST /webhooks/asaas existente (routes/pagamentos.js) já atualiza
// qualquer tenant pelo asaas_subscription_id, Studio ou CRM.
const planos = require('../lib/planos');
const asaasService = require('../asaas-service');
const { UF_VALIDAS } = require('../lib/validadores');
const { montarResumoPagamentos } = require('../lib/pagamentos');
const { listarPacotes, obterPacote, confirmarCompraCreditos } = require('../lib/creditos-crm');

function tokenInternoValido(headerRecebido, tokenEsperado) {
  return !!headerRecebido && !!tokenEsperado && headerRecebido === tokenEsperado;
}

function registerPagamentosCrmRoutes(fastify, pool) {
  const CARTAO_FINAL_REGEX = /^\d{4}$/;
  const CPF_CNPJ_REGEX = /^\d{11}$|^\d{14}$/;

  fastify.decorate('autenticarInternoPagamentosCrm', async (request, reply) => {
    if (!tokenInternoValido(request.headers['x-internal-token'], process.env.INTERNAL_PAGAMENTOS_CRM_TOKEN)) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
  });

  const guard = { preHandler: [fastify.autenticarInternoPagamentosCrm] };

  fastify.get('/internal/pagamentos-crm/:tenantId', guard, async (request, reply) => {
    const { tenantId } = request.params;
    const { rows } = await pool.query(
      `SELECT plano, status, ativado_em, status_alterado_em, asaas_customer_id, asaas_subscription_id,
              asaas_meio_pagamento, asaas_meio_pagamento_alterado_em, asaas_cartao_final, cpf_cnpj, cancelado_em, acesso_ate,
              endereco_cep, endereco_logradouro, endereco_numero,
              endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Tenant não encontrado' });
    return montarResumoPagamentos(rows[0], null);
  });

  fastify.get('/internal/planos-crm', guard, async () => {
    const todos = planos.obterTodos();
    return todos.filter((p) => p.produto === 'crm' || p.chave.startsWith('crm_'));
  });

  fastify.post('/internal/pagamentos-crm/:tenantId/cadastrar', guard, async (request, reply) => {
    const { tenantId } = request.params;
    const {
      email, nome,
      plano: planoChave,
      meio,
      cpf_cnpj: cpfCnpjBruto,
      cartao_numero: cartaoNumeroBruto,
      cartao_nome: cartaoNome,
      cartao_validade_mes: cartaoValidadeMes,
      cartao_validade_ano: cartaoValidadeAno,
      cartao_cvv: cartaoCvv,
      telefone: telefoneBruto,
      endereco: enderecoBruto,
    } = request.body || {};

    if (!['pix', 'cartao'].includes(meio)) {
      return reply.code(400).send({ error: 'Campo "meio" deve ser "pix" ou "cartao"' });
    }

    const cartaoNumeroLimpo = String(cartaoNumeroBruto || '').replace(/\D/g, '');
    if (meio === 'cartao') {
      if (!CARTAO_FINAL_REGEX.test(cartaoNumeroLimpo.slice(-4))) {
        return reply.code(400).send({ error: 'Informe um número de cartão válido.' });
      }
      if (!(cartaoNome || '').trim()) {
        return reply.code(400).send({ error: 'Informe o nome impresso no cartão.' });
      }
      if (!/^\d{1,2}$/.test(cartaoValidadeMes || '') || !/^\d{4}$/.test(cartaoValidadeAno || '')) {
        return reply.code(400).send({ error: 'Informe a validade do cartão (MM/AAAA).' });
      }
      if (!/^\d{3,4}$/.test(cartaoCvv || '')) {
        return reply.code(400).send({ error: 'Informe o CVV do cartão.' });
      }
    }

    const { rows } = await pool.query(
      `SELECT plano, status, ativado_em, asaas_customer_id, asaas_subscription_id, cpf_cnpj,
              endereco_cep, endereco_logradouro, endereco_numero,
              endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = rows[0];
    if (!tenant) return reply.code(404).send({ error: 'Tenant não encontrado' });

    const cpfCnpjLimpo = String(cpfCnpjBruto || '').replace(/\D/g, '') || tenant.cpf_cnpj;
    if (!tenant.asaas_customer_id && !CPF_CNPJ_REGEX.test(cpfCnpjLimpo || '')) {
      return reply.code(400).send({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' });
    }

    const telefoneLimpo = String(telefoneBruto || '').replace(/\D/g, '');
    if (meio === 'cartao' && !/^\d{10,11}$/.test(telefoneLimpo || '')) {
      return reply.code(400).send({ error: 'Informe o telefone (com DDD) do titular do cartão.' });
    }

    let endereco = {
      cep: tenant.endereco_cep, logradouro: tenant.endereco_logradouro, numero: tenant.endereco_numero,
      complemento: tenant.endereco_complemento, bairro: tenant.endereco_bairro,
      cidade: tenant.endereco_cidade, uf: tenant.endereco_uf,
    };
    if (meio === 'cartao') {
      if (enderecoBruto) {
        const { cep, logradouro, numero, complemento, bairro, cidade, uf } = enderecoBruto;
        const cepLimpo = String(cep || '').replace(/\D/g, '');
        const enderecoValido =
          /^\d{8}$/.test(cepLimpo) && (logradouro || '').trim() && (numero || '').trim() &&
          (bairro || '').trim() && (cidade || '').trim() && UF_VALIDAS.includes(String(uf || '').toUpperCase());
        if (!enderecoValido) return reply.code(400).send({ error: 'Preencha todos os campos do endereço.' });
        endereco = {
          cep: cepLimpo, logradouro: logradouro.trim(), numero: numero.trim(),
          complemento: (complemento || '').trim() || null, bairro: bairro.trim(),
          cidade: cidade.trim(), uf: String(uf).toUpperCase(),
        };
      } else if (!(endereco.cep && endereco.numero)) {
        return reply.code(400).send({ error: 'Informe seu endereço para cadastrar um cartão.' });
      }
    }

    // Diferente do Studio (que sempre tem um plano padrão pra sair do
    // trial): CRM exige escolha explícita de plano na primeira assinatura —
    // sem fallback silencioso pro plano de outro produto. `tenant.plano`
    // só vale como "já escolhido" quando a assinatura está ativa — cancelada
    // mantém o campo preenchido só pra exibição (ver plano-cobranca.html),
    // senão reassinar escolhendo um plano diferente do que tinha era
    // ignorado silenciosamente (achado 2026-10-26).
    const chavePlano = (tenant.status !== 'cancelado' && tenant.plano) || planoChave;
    if (!chavePlano) return reply.code(400).send({ error: 'Escolha um plano.' });
    const planoInfo = planos.obterPlano(chavePlano);
    if (!planoInfo) return reply.code(400).send({ error: 'Plano não encontrado.' });

    const billingType = meio === 'pix' ? 'PIX' : 'CREDIT_CARD';
    const cartaoFinal = meio === 'cartao' ? cartaoNumeroLimpo.slice(-4) : null;

    let customer;
    let subscriptionId;
    try {
      customer = await asaasService.criarOuRecuperarCustomer({
        tenantId, nome, email, cpfCnpj: cpfCnpjLimpo, asaasCustomerId: tenant.asaas_customer_id,
      });

      let creditCardToken;
      if (meio === 'cartao') {
        const tokenizado = await asaasService.tokenizarCartao({
          customerId: customer.id,
          holderName: cartaoNome.trim(),
          number: cartaoNumeroLimpo,
          expiryMonth: cartaoValidadeMes,
          expiryYear: cartaoValidadeAno,
          ccv: cartaoCvv,
          holderInfo: {
            name: nome, email, cpfCnpj: cpfCnpjLimpo,
            postalCode: endereco.cep, addressNumber: endereco.numero,
            addressComplement: endereco.complemento || undefined,
            mobilePhone: telefoneLimpo || undefined,
          },
          remoteIp: request.ip,
        });
        creditCardToken = tokenizado.creditCardToken;
      }

      if (tenant.asaas_subscription_id && tenant.status !== 'cancelado') {
        await asaasService.atualizarSubscription({
          subscriptionId: tenant.asaas_subscription_id, billingType, creditCardToken, tenantId,
        });
        subscriptionId = tenant.asaas_subscription_id;
      } else {
        const subscription = await asaasService.criarSubscription({
          customerId: customer.id, billingType, valor: Number(planoInfo.preco_mensal), planoNome: planoInfo.nome,
          nextDueDate: new Date().toISOString().slice(0, 10), creditCardToken, tenantId,
        });
        subscriptionId = subscription.id;
      }
    } catch (erro) {
      request.log.error(`[pagamentos-crm] falha na integração com a Asaas para tenant ${tenantId}: ${erro.message}`);
      return reply.code(400).send({ error: 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' });
    }

    const { rows: atualizado } = await pool.query(
      `UPDATE tenants SET
         asaas_customer_id = $2, asaas_subscription_id = $3, plano = $4, status = 'ativo',
         asaas_meio_pagamento = $5, asaas_meio_pagamento_alterado_em = now(), asaas_cartao_final = $6, cpf_cnpj = $7,
         endereco_cep = $8, endereco_logradouro = $9, endereco_numero = $10, endereco_complemento = $11,
         endereco_bairro = $12, endereco_cidade = $13, endereco_uf = $14, cancelado_em = null, acesso_ate = null
       WHERE id = $1
       RETURNING plano, status, ativado_em, status_alterado_em, asaas_customer_id, asaas_subscription_id,
                 asaas_meio_pagamento, asaas_meio_pagamento_alterado_em, asaas_cartao_final, cpf_cnpj, cancelado_em, acesso_ate,
                 endereco_cep, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf`,
      [
        tenantId, customer.id, subscriptionId, planoInfo.chave, meio,
        meio === 'cartao' ? cartaoFinal : null, cpfCnpjLimpo,
        endereco.cep, endereco.logradouro, endereco.numero, endereco.complemento, endereco.bairro, endereco.cidade, endereco.uf,
      ]
    );

    return montarResumoPagamentos(atualizado[0], null);
  });

  fastify.patch('/internal/pagamentos-crm/:tenantId/plano', guard, async (request, reply) => {
    const { tenantId } = request.params;
    const { plano } = request.body || {};

    const planoInfo = planos.obterPlano(plano);
    if (!planoInfo || !(planoInfo.produto === 'crm' || planoInfo.chave.startsWith('crm_'))) {
      return reply.code(400).send({ error: 'Plano inválido ou não disponível.' });
    }

    const { rows } = await pool.query('SELECT plano, status, asaas_subscription_id FROM tenants WHERE id = $1', [tenantId]);
    const tenant = rows[0];
    if (!tenant || !tenant.asaas_subscription_id || tenant.status === 'cancelado') {
      return reply.code(400).send({ error: 'Nenhuma assinatura ativa pra trocar de plano. Cadastre uma forma de pagamento primeiro.' });
    }
    if (tenant.plano === planoInfo.chave) {
      return reply.code(400).send({ error: 'Você já está nesse plano.' });
    }

    try {
      await asaasService.atualizarSubscription({
        subscriptionId: tenant.asaas_subscription_id, valor: Number(planoInfo.preco_mensal), tenantId,
      });
    } catch (erro) {
      request.log.error(`[pagamentos-crm] falha ao trocar plano do tenant ${tenantId} para ${planoInfo.chave}: ${erro.message}`);
      return reply.code(400).send({ error: 'Não foi possível trocar de plano agora. Tente novamente em instantes.' });
    }

    const { rows: atualizado } = await pool.query(
      `UPDATE tenants SET plano = $2 WHERE id = $1
       RETURNING plano, status, ativado_em, status_alterado_em, asaas_customer_id, asaas_subscription_id,
                 asaas_meio_pagamento, asaas_meio_pagamento_alterado_em, asaas_cartao_final, cpf_cnpj, cancelado_em, acesso_ate,
                 endereco_cep, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf`,
      [tenantId, planoInfo.chave]
    );
    return montarResumoPagamentos(atualizado[0], null);
  });

  fastify.delete('/internal/pagamentos-crm/:tenantId/assinatura', guard, async (request, reply) => {
    const { tenantId } = request.params;
    const { rows } = await pool.query('SELECT status, asaas_subscription_id FROM tenants WHERE id = $1', [tenantId]);
    const tenant = rows[0];
    if (!tenant) return reply.code(404).send({ error: 'Tenant não encontrado' });
    if (tenant.status !== 'ativo') return reply.code(400).send({ error: 'Só é possível cancelar uma assinatura ativa.' });
    if (!tenant.asaas_subscription_id) return reply.code(400).send({ error: 'Nenhuma assinatura encontrada para cancelar.' });

    let acessoAte;
    try {
      const subscription = await asaasService.buscarSubscription(tenant.asaas_subscription_id);
      acessoAte = subscription ? subscription.nextDueDate : null;
      await asaasService.cancelarSubscription({ subscriptionId: tenant.asaas_subscription_id, tenantId });
    } catch (erro) {
      request.log.error(`[pagamentos-crm] falha ao cancelar assinatura na Asaas para tenant ${tenantId}: ${erro.message}`);
      return reply.code(400).send({ error: 'Não foi possível cancelar a assinatura agora. Tente novamente em instantes.' });
    }

    await pool.query(`UPDATE tenants SET status = 'cancelado', cancelado_em = NOW(), acesso_ate = $2 WHERE id = $1`, [tenantId, acessoAte]);
    return { cancelado: true, acesso_ate: acessoAte };
  });

  // --- Créditos de WhatsApp (automações, compra avulsa) ----------------------
  // Diferente do plano/assinatura acima: cobrança única via Asaas POST
  // /payments (ver criarCobranca em @kyvvohq/asaas), não recorrente. O saldo
  // em si vive no banco do CRM (debitado a cada disparo de automação) — aqui
  // só fica o registro do pagamento, pra conferir o webhook e decidir quando
  // avisar o CRM pra creditar (lib/creditos-crm#confirmarCompraCreditos).
  fastify.get('/internal/pagamentos-crm/creditos/pacotes', guard, async () => listarPacotes());

  fastify.get('/internal/pagamentos-crm/:tenantId/creditos', guard, async (request) => {
    const { rows } = await pool.query(
      `SELECT id, pacote_chave, quantidade_creditos, valor, meio, status, criado_em, creditado_em
         FROM compras_creditos_crm WHERE tenant_id = $1 ORDER BY criado_em DESC LIMIT 10`,
      [request.params.tenantId]
    );
    return rows;
  });

  fastify.post('/internal/pagamentos-crm/:tenantId/creditos/comprar', guard, async (request, reply) => {
    const { tenantId } = request.params;
    const {
      pacote: pacoteChave, meio, email, nome,
      cpf_cnpj: cpfCnpjBruto,
      cartao_numero: cartaoNumeroBruto, cartao_nome: cartaoNome,
      cartao_validade_mes: cartaoValidadeMes, cartao_validade_ano: cartaoValidadeAno, cartao_cvv: cartaoCvv,
      telefone: telefoneBruto, endereco: enderecoBruto,
    } = request.body || {};

    const pacote = obterPacote(pacoteChave);
    if (!pacote) return reply.code(400).send({ error: 'Pacote de créditos inválido.' });
    if (!['pix', 'cartao'].includes(meio)) return reply.code(400).send({ error: 'Campo "meio" deve ser "pix" ou "cartao"' });
    if (!(email || '').trim() || !(nome || '').trim()) return reply.code(400).send({ error: 'Nome e e-mail são obrigatórios.' });

    const cartaoNumeroLimpo = String(cartaoNumeroBruto || '').replace(/\D/g, '');
    if (meio === 'cartao') {
      if (!CARTAO_FINAL_REGEX.test(cartaoNumeroLimpo.slice(-4))) return reply.code(400).send({ error: 'Informe um número de cartão válido.' });
      if (!(cartaoNome || '').trim()) return reply.code(400).send({ error: 'Informe o nome impresso no cartão.' });
      if (!/^\d{1,2}$/.test(cartaoValidadeMes || '') || !/^\d{4}$/.test(cartaoValidadeAno || '')) return reply.code(400).send({ error: 'Informe a validade do cartão (MM/AAAA).' });
      if (!/^\d{3,4}$/.test(cartaoCvv || '')) return reply.code(400).send({ error: 'Informe o CVV do cartão.' });
    }

    const { rows } = await pool.query(
      `SELECT asaas_customer_id, cpf_cnpj, endereco_cep, endereco_logradouro, endereco_numero,
              endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf
         FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = rows[0];
    if (!tenant) return reply.code(404).send({ error: 'Tenant não encontrado' });

    const cpfCnpjLimpo = String(cpfCnpjBruto || '').replace(/\D/g, '') || tenant.cpf_cnpj;
    if (!tenant.asaas_customer_id && !CPF_CNPJ_REGEX.test(cpfCnpjLimpo || '')) {
      return reply.code(400).send({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' });
    }

    const telefoneLimpo = String(telefoneBruto || '').replace(/\D/g, '');
    if (meio === 'cartao' && !/^\d{10,11}$/.test(telefoneLimpo || '')) {
      return reply.code(400).send({ error: 'Informe o telefone (com DDD) do titular do cartão.' });
    }

    let endereco = {
      cep: tenant.endereco_cep, logradouro: tenant.endereco_logradouro, numero: tenant.endereco_numero,
      complemento: tenant.endereco_complemento, bairro: tenant.endereco_bairro,
      cidade: tenant.endereco_cidade, uf: tenant.endereco_uf,
    };
    if (meio === 'cartao') {
      if (enderecoBruto) {
        const { cep, logradouro, numero, complemento, bairro, cidade, uf } = enderecoBruto;
        const cepLimpo = String(cep || '').replace(/\D/g, '');
        const enderecoValido =
          /^\d{8}$/.test(cepLimpo) && (logradouro || '').trim() && (numero || '').trim() &&
          (bairro || '').trim() && (cidade || '').trim() && UF_VALIDAS.includes(String(uf || '').toUpperCase());
        if (!enderecoValido) return reply.code(400).send({ error: 'Preencha todos os campos do endereço.' });
        endereco = {
          cep: cepLimpo, logradouro: logradouro.trim(), numero: numero.trim(),
          complemento: (complemento || '').trim() || null, bairro: bairro.trim(),
          cidade: cidade.trim(), uf: String(uf).toUpperCase(),
        };
      } else if (!(endereco.cep && endereco.numero)) {
        return reply.code(400).send({ error: 'Informe seu endereço para cadastrar um cartão.' });
      }
    }

    const billingType = meio === 'pix' ? 'PIX' : 'CREDIT_CARD';
    const hoje = new Date().toISOString().slice(0, 10);

    let customer;
    let pagamento;
    try {
      customer = await asaasService.criarOuRecuperarCustomer({ tenantId, nome, email, cpfCnpj: cpfCnpjLimpo, asaasCustomerId: tenant.asaas_customer_id });

      let creditCardToken;
      if (meio === 'cartao') {
        const tokenizado = await asaasService.tokenizarCartao({
          customerId: customer.id, holderName: cartaoNome.trim(), number: cartaoNumeroLimpo,
          expiryMonth: cartaoValidadeMes, expiryYear: cartaoValidadeAno, ccv: cartaoCvv,
          holderInfo: {
            name: nome, email, cpfCnpj: cpfCnpjLimpo, postalCode: endereco.cep, addressNumber: endereco.numero,
            addressComplement: endereco.complemento || undefined, mobilePhone: telefoneLimpo || undefined,
          },
          remoteIp: request.ip,
        });
        creditCardToken = tokenizado.creditCardToken;
      }

      pagamento = await asaasService.criarCobranca({
        customerId: customer.id, billingType, valor: pacote.valor,
        descricao: `Kyvvo CRM — ${pacote.quantidade} créditos de WhatsApp`,
        dueDate: hoje, creditCardToken, tenantId, externalReference: `creditos_crm:${tenantId}`,
      });
    } catch (erro) {
      request.log.error(`[pagamentos-crm] falha na compra de créditos do tenant ${tenantId}: ${erro.message}`);
      // Diferente do cancelamento/troca de plano (mensagem genérica de
      // propósito): aqui a mensagem da Asaas costuma ser acionável pelo
      // próprio tenant (CPF/cartão invalido) OU sinaliza config de conta que
      // o Bruno precisa resolver direto com a Asaas (ex.: permissão de
      // cobrança avulsa) — nos dois casos, esconder o texto só confunde quem
      // está testando/reportando o problema.
      return reply.code(400).send({ error: erro.message || 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' });
    }

    // Nasce sempre 'pendente' — cartão confirma na hora (chamada logo abaixo,
    // mesma rotina do webhook); Pix só confirma depois, assíncrono.
    const { rows: compraRows } = await pool.query(
      `INSERT INTO compras_creditos_crm (tenant_id, pacote_chave, quantidade_creditos, valor, meio, asaas_customer_id, asaas_payment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [tenantId, pacote.chave, pacote.quantidade, pacote.valor, meio, customer.id, pagamento.id]
    );
    const compraId = compraRows[0].id;

    let pixQrCode = null;
    if (meio === 'pix') {
      try {
        const qr = await asaasService.buscarPixQrCode(pagamento.id);
        pixQrCode = { payload: qr.payload, encodedImage: qr.encodedImage, expirationDate: qr.expirationDate };
      } catch (erro) {
        request.log.error(`[pagamentos-crm] falha ao buscar QR code Pix (payment ${pagamento.id}): ${erro.message}`);
      }
    }

    let status = 'pendente';
    if (pagamento.status === 'CONFIRMED') {
      try {
        await confirmarCompraCreditos(pool, pagamento.id);
        status = 'confirmada';
      } catch (erro) {
        request.log.error(`[pagamentos-crm] pagamento confirmado mas falha ao creditar no CRM (payment ${pagamento.id}): ${erro.message}`);
      }
    }

    return { compraId, status, quantidade: pacote.quantidade, valor: pacote.valor, pixQrCode };
  });
}

module.exports = { registerPagamentosCrmRoutes };
