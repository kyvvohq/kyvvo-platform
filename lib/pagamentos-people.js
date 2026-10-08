// Portado verbatim de kyvvo-people/index.js (montarResumoPagamento) —
// histórico (aba "Histórico" de Plano e Cobrança) vem direto da Asaas, sem
// tabela própria: plano_nome/ciclo usam o plano ATUAL da assinatura pra
// toda linha, já que a Asaas não guarda o plano Kyvvo por cobrança
// histórica (trocar de plano reaproveita a mesma subscription).
const asaas = require('./asaas-people');

async function montarResumoPagamento(a, planoNome) {
  if (!a) return null;
  const historico = await asaas.listarUltimasCobrancas(a.asaas_subscription_id).catch((erro) => {
    console.error(`[pagamentos-people] falha ao listar cobranças da subscription ${a.asaas_subscription_id}: ${erro.message}`);
    return [];
  });
  return {
    plano: a.plano,
    ciclo: a.ciclo,
    status: a.status,
    asaas_meio_pagamento: a.asaas_meio_pagamento,
    asaas_cartao_final: a.asaas_cartao_final,
    cpf_cnpj: a.cpf_cnpj,
    contato_telefone: a.contato_telefone,
    tem_assinatura: Boolean(a.asaas_subscription_id),
    cancelado_em: a.cancelado_em,
    acesso_ate: a.acesso_ate,
    historico: historico.map((p) => ({
      data: p.dueDate,
      plano_nome: planoNome || null,
      valor: p.value,
      ciclo: a.ciclo === 'anual' ? 'Anual' : 'Mensal',
      status: p.status,
      meio: p.billingType,
    })),
  };
}

module.exports = { montarResumoPagamento };
