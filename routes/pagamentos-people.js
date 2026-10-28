// Portado verbatim de kyvvo-people/index.js (linhas ~390-722, corte P3 —
// billing do People vira serviço da plataforma). Diferenças deliberadas do
// original:
//  - `pool` aqui é a connection pool do banco PRÓPRIO do People
//    (`PEOPLE_DATABASE_URL`, ver lib/db-people.js) — não o pool principal
//    do platform, que não tem a tabela `assinaturas` (ela nunca morou no
//    mesmo banco/schema do Studio).
//  - Catálogo de planos lido localmente (lib/planos-people.js, tabela
//    `planos` do platform) em vez de round-trip HTTP pra
//    studio.kyvvo.com.br/api/planos/people — mesmo dado, sem a dependência
//    externa. kyvvo-people/lib/planos.js (o original) continua como está,
//    fora de escopo.
//  - Sem fastify.requireAdmin: o People original só exige
//    fastify.authenticate nessas rotas (diferente do Studio, que também
//    exige admin) — mantido igual pra não mudar quem pode mexer na
//    assinatura.
const asaas = require('../lib/asaas-people');
const planosPeople = require('../lib/planos-people');
const { montarResumoPagamento } = require('../lib/pagamentos-people');

const UF_VALIDAS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];
// Anual = valor da parcela mensal × 10 (2 meses de desconto), sempre
// calculado aqui a partir de planoInfo.preco_mensal — nunca aceito do
// cliente. `cycle` já sai no formato que a API da Asaas espera.
const MULTIPLICADOR_CICLO = { mensal: 1, anual: 10 };
const CICLO_ASAAS = { mensal: 'MONTHLY', anual: 'YEARLY' };

// SUBSCRIPTION_CANCELLED não existe na API da Asaas — o evento certo pra
// assinatura removida via DELETE /subscriptions/:id é SUBSCRIPTION_DELETED.
// PAYMENT_REFUNDED/PAYMENT_CHARGEBACK_REQUESTED também mapeados (achado
// kyvvo-people 2026-08-31: um estorno de teste não suspendia a assinatura
// porque nenhum dos dois eventos tinha mapeamento).
const ASAAS_EVENTO_PARA_STATUS = {
  PAYMENT_CONFIRMED: 'ativo',
  PAYMENT_RECEIVED: 'ativo',
  PAYMENT_OVERDUE: 'inadimplente',
  PAYMENT_DELETED: 'suspenso',
  PAYMENT_REFUNDED: 'suspenso',
  PAYMENT_CHARGEBACK_REQUESTED: 'suspenso',
  SUBSCRIPTION_DELETED: 'cancelado',
};

function registerPagamentosPeopleRoutes(fastify, pool, peoplePool) {
  const CARTAO_FINAL_REGEX = /^\d{4}$/;
  const CPF_CNPJ_REGEX = /^\d{11}$|^\d{14}$/;

  fastify.get('/people/api/pagamentos', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { rows } = await peoplePool.query('select * from assinaturas where tenant_id = $1', [request.user.tenantId]);
    if (!rows[0]) return reply.code(404).send({ error: 'Assinatura não encontrada' });
    let planoNome = null;
    if (rows[0].plano) {
      const planoInfo = await planosPeople.buscarPlano(pool, rows[0].plano).catch(() => null);
      planoNome = planoInfo ? planoInfo.nome : null;
    }
    return montarResumoPagamento(rows[0], planoNome);
  });

  fastify.get('/people/api/pagamentos/planos', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      return await planosPeople.buscarPlanos(pool);
    } catch (err) {
      request.log.error(`Falha ao buscar planos do People: ${err.message}`);
      return reply.code(502).send({ error: 'Não foi possível carregar os planos agora. Tente novamente em instantes.' });
    }
  });

  // Orquestra Customer + Subscription no Asaas — cria na primeira vez; se o
  // tenant já tem assinatura, só troca o meio de pagamento (atualiza, nunca
  // cancela). Cartão: número/validade/CVV chegam brutos (via HTTPS) e são
  // tokenizados neste handler, nunca armazenados nem logados — só repassados
  // à Asaas e descartados.
  fastify.post('/people/api/pagamentos/cadastrar', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { tenantId, email, nome } = request.user;
    const {
      plano: planoChave,
      meio,
      ciclo: cicloBruto,
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

    const { rows } = await peoplePool.query('select * from assinaturas where tenant_id = $1', [tenantId]);
    const assinatura = rows[0];
    if (!assinatura) return reply.code(404).send({ error: 'Assinatura não encontrada' });

    const ciclo = ['mensal', 'anual'].includes(cicloBruto) ? cicloBruto : (assinatura.ciclo || 'mensal');

    const cpfCnpjLimpo = String(cpfCnpjBruto || '').replace(/\D/g, '') || assinatura.cpf_cnpj;
    if (!assinatura.asaas_customer_id && !CPF_CNPJ_REGEX.test(cpfCnpjLimpo || '')) {
      return reply.code(400).send({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' });
    }

    // A Asaas exige o telefone (celular, DDD + 9 dígitos) do titular do
    // cartão pra tokenizar — reaproveita o valor já salvo (mesmo padrão do
    // CPF/CNPJ) pra não pedir de novo em toda troca de cartão.
    const telefoneLimpo = String(telefoneBruto || '').replace(/\D/g, '') || assinatura.contato_telefone;
    if (meio === 'cartao' && !/^\d{10,11}$/.test(telefoneLimpo || '')) {
      return reply.code(400).send({ error: 'Informe o telefone (com DDD) do titular do cartão.' });
    }

    let endereco = {
      cep: assinatura.endereco_cep,
      logradouro: assinatura.endereco_logradouro,
      numero: assinatura.endereco_numero,
      complemento: assinatura.endereco_complemento,
      bairro: assinatura.endereco_bairro,
      cidade: assinatura.endereco_cidade,
      uf: assinatura.endereco_uf,
    };
    if (meio === 'cartao') {
      if (enderecoBruto) {
        const { cep, logradouro, numero, complemento, bairro, cidade, uf } = enderecoBruto;
        const cepLimpo = String(cep || '').replace(/\D/g, '');
        const enderecoValido =
          /^\d{8}$/.test(cepLimpo) &&
          (logradouro || '').trim() &&
          (numero || '').trim() &&
          (bairro || '').trim() &&
          (cidade || '').trim() &&
          UF_VALIDAS.includes(String(uf || '').toUpperCase());
        if (!enderecoValido) {
          return reply.code(400).send({ error: 'Preencha todos os campos do endereço.' });
        }
        endereco = {
          cep: cepLimpo, logradouro: logradouro.trim(), numero: numero.trim(),
          complemento: (complemento || '').trim() || null, bairro: bairro.trim(),
          cidade: cidade.trim(), uf: String(uf).toUpperCase(),
        };
      } else if (!(endereco.cep && endereco.numero)) {
        return reply.code(400).send({ error: 'Informe seu endereço para cadastrar um cartão.' });
      }
    }

    const chavePlano = assinatura.plano || planoChave;
    if (!chavePlano) return reply.code(400).send({ error: 'Escolha um plano.' });
    let planoInfo;
    try {
      planoInfo = await planosPeople.buscarPlano(pool, chavePlano);
    } catch (err) {
      request.log.error(`Falha ao buscar plano ${chavePlano}: ${err.message}`);
      return reply.code(502).send({ error: 'Não foi possível confirmar o plano agora. Tente novamente em instantes.' });
    }
    if (!planoInfo) return reply.code(400).send({ error: 'Plano não encontrado.' });

    const billingType = meio === 'pix' ? 'PIX' : 'CREDIT_CARD';
    const cartaoFinal = meio === 'cartao' ? cartaoNumeroLimpo.slice(-4) : null;

    let customer;
    let subscriptionId;
    let assinaturaNova = false;
    try {
      customer = await asaas.criarOuRecuperarCustomer({
        tenantId, nome, email, cpfCnpj: cpfCnpjLimpo, asaasCustomerId: assinatura.asaas_customer_id,
      });

      let creditCardToken;
      if (meio === 'cartao') {
        const tokenizado = await asaas.tokenizarCartao({
          customerId: customer.id,
          holderName: cartaoNome.trim(),
          number: cartaoNumeroLimpo,
          // Padding pro formato que a Asaas exige — ver pagamentos.js.
          expiryMonth: String(cartaoValidadeMes).padStart(2, '0'),
          expiryYear: cartaoValidadeAno,
          ccv: cartaoCvv,
          holderInfo: {
            name: nome,
            email,
            cpfCnpj: cpfCnpjLimpo,
            postalCode: endereco.cep,
            addressNumber: endereco.numero,
            addressComplement: endereco.complemento || undefined,
            mobilePhone: telefoneLimpo,
          },
          remoteIp: request.ip,
        });
        creditCardToken = tokenizado.creditCardToken;
      }

      const valorCiclo = Number(planoInfo.preco_mensal) * MULTIPLICADOR_CICLO[ciclo];

      if (assinatura.asaas_subscription_id && assinatura.status !== 'cancelado') {
        await asaas.atualizarSubscription({
          subscriptionId: assinatura.asaas_subscription_id, billingType, creditCardToken,
          valor: valorCiclo, cycle: CICLO_ASAAS[ciclo], planoNome: planoInfo.nome, tenantId,
        });
        subscriptionId = assinatura.asaas_subscription_id;
      } else {
        const subscription = await asaas.criarSubscription({
          customerId: customer.id, billingType, valor: valorCiclo, planoNome: planoInfo.nome,
          nextDueDate: new Date().toISOString().slice(0, 10), creditCardToken, tenantId, cycle: CICLO_ASAAS[ciclo],
        });
        subscriptionId = subscription.id;
        assinaturaNova = true;
      }
    } catch (erro) {
      request.log.error(`Falha na integração com a Asaas para tenant ${tenantId}: ${erro.message}`);
      return reply.code(400).send({ error: 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' });
    }

    // Criar a Subscription não significa que já foi paga — correção:
    // 'ativo' só quando o webhook confirmar de verdade (PAYMENT_CONFIRMED/
    // PAYMENT_RECEIVED) — até lá fica 'pendente'. Só se aplica a assinatura
    // NOVA; trocar de forma de pagamento numa assinatura já ativa não mexe
    // no status atual.
    const novoStatus = assinaturaNova ? 'pendente' : assinatura.status;

    const { rows: atualizado } = await peoplePool.query(
      `update assinaturas set
         asaas_customer_id = $2, asaas_subscription_id = $3, plano = $4, status = $5,
         asaas_meio_pagamento = $6, asaas_cartao_final = $7, cpf_cnpj = $8,
         endereco_cep = $9, endereco_logradouro = $10, endereco_numero = $11, endereco_complemento = $12,
         endereco_bairro = $13, endereco_cidade = $14, endereco_uf = $15, contato_telefone = $16, ciclo = $17,
         cancelado_em = null, acesso_ate = null, status_alterado_em = now(), atualizado_em = now()
       where tenant_id = $1
       returning *`,
      [
        tenantId, customer.id, subscriptionId, planoInfo.chave, novoStatus, meio,
        meio === 'cartao' ? cartaoFinal : null, cpfCnpjLimpo,
        endereco.cep, endereco.logradouro, endereco.numero, endereco.complemento, endereco.bairro, endereco.cidade, endereco.uf,
        telefoneLimpo || null, ciclo,
      ]
    );

    return await montarResumoPagamento(atualizado[0], planoInfo.nome);
  });

  fastify.patch('/people/api/pagamentos/plano', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { tenantId } = request.user;
    const { plano: planoChave, ciclo: cicloBruto } = request.body || {};

    let planoInfo;
    try {
      planoInfo = await planosPeople.buscarPlano(pool, planoChave);
    } catch (err) {
      request.log.error(`Falha ao buscar plano ${planoChave}: ${err.message}`);
      return reply.code(502).send({ error: 'Não foi possível confirmar o plano agora. Tente novamente em instantes.' });
    }
    if (!planoInfo) return reply.code(400).send({ error: 'Plano inválido ou não disponível.' });

    const { rows } = await peoplePool.query('select * from assinaturas where tenant_id = $1', [tenantId]);
    const assinatura = rows[0];
    if (!assinatura || !assinatura.asaas_subscription_id || assinatura.status === 'cancelado') {
      return reply.code(400).send({ error: 'Nenhuma assinatura ativa pra trocar de plano. Cadastre uma forma de pagamento primeiro.' });
    }
    const ciclo = ['mensal', 'anual'].includes(cicloBruto) ? cicloBruto : assinatura.ciclo;
    if (assinatura.plano === planoInfo.chave && assinatura.ciclo === ciclo) {
      return reply.code(400).send({ error: 'Você já está nesse plano.' });
    }

    const valorCiclo = Number(planoInfo.preco_mensal) * MULTIPLICADOR_CICLO[ciclo];
    try {
      await asaas.atualizarSubscription({
        subscriptionId: assinatura.asaas_subscription_id, valor: valorCiclo, cycle: CICLO_ASAAS[ciclo],
        planoNome: planoInfo.nome, tenantId,
      });
    } catch (erro) {
      request.log.error(`Falha ao trocar plano do tenant ${tenantId} para ${planoInfo.chave}/${ciclo}: ${erro.message}`);
      return reply.code(400).send({ error: 'Não foi possível trocar de plano agora. Tente novamente em instantes.' });
    }

    const { rows: atualizado } = await peoplePool.query(
      'update assinaturas set plano = $2, ciclo = $3, atualizado_em = now() where tenant_id = $1 returning *',
      [tenantId, planoInfo.chave, ciclo]
    );
    return await montarResumoPagamento(atualizado[0], planoInfo.nome);
  });

  fastify.delete('/people/api/pagamentos/assinatura', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await peoplePool.query('select * from assinaturas where tenant_id = $1', [tenantId]);
    const assinatura = rows[0];
    if (!assinatura) return reply.code(404).send({ error: 'Assinatura não encontrada' });
    // 'pendente' inclui de propósito — cancelar antes da 1ª confirmação
    // (ex: desistiu de pagar o Pix) precisa ser possível, não só depois de
    // já estar 'ativo'.
    if (!['ativo', 'pendente', 'inadimplente'].includes(assinatura.status)) {
      return reply.code(400).send({ error: 'Não há assinatura em cobrança pra cancelar.' });
    }
    if (!assinatura.asaas_subscription_id) {
      return reply.code(400).send({ error: 'Nenhuma assinatura encontrada para cancelar.' });
    }

    let acessoAte;
    try {
      const subscription = await asaas.buscarSubscription(assinatura.asaas_subscription_id);
      acessoAte = subscription ? subscription.nextDueDate : null;
      await asaas.cancelarSubscription({ subscriptionId: assinatura.asaas_subscription_id, tenantId });
    } catch (erro) {
      request.log.error(`Falha ao cancelar assinatura na Asaas para tenant ${tenantId}: ${erro.message}`);
      return reply.code(400).send({ error: 'Não foi possível cancelar a assinatura agora. Tente novamente em instantes.' });
    }

    await peoplePool.query(
      `update assinaturas set status = 'cancelado', cancelado_em = now(), acesso_ate = $2, status_alterado_em = now(), atualizado_em = now() where tenant_id = $1`,
      [tenantId, acessoAte]
    );
    return { cancelado: true, acesso_ate: acessoAte };
  });

  // Webhook da Asaas: atualiza o status da assinatura conforme o evento da
  // cobrança. Sem fastify.authenticate — quem chama é a Asaas, não um
  // usuário logado; a validação é pelo token no header.
  fastify.post('/people/webhooks/asaas', async (request, reply) => {
    const tokenEsperado = process.env.ASAAS_WEBHOOK_TOKEN;
    const tokenRecebido = request.headers['asaas-access-token'];
    if (!tokenEsperado || tokenRecebido !== tokenEsperado) {
      return reply.code(401).send({ error: 'Token de webhook inválido' });
    }

    const { event, payment, subscription } = request.body || {};
    const novoStatus = ASAAS_EVENTO_PARA_STATUS[event];
    if (!novoStatus) {
      request.log.info(`Webhook Asaas (People): evento "${event}" sem mapeamento, ignorado`);
      return { ok: true };
    }
    const subscriptionId = (payment && payment.subscription) || (subscription && subscription.id);
    if (!subscriptionId) return { ok: true };

    await peoplePool.query(
      `update assinaturas set status = $2, status_alterado_em = now(), atualizado_em = now()
       where asaas_subscription_id = $1 and status is distinct from $2`,
      [subscriptionId, novoStatus]
    );
    return { ok: true };
  });
}

module.exports = { registerPagamentosPeopleRoutes };
