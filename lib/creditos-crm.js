// Pacotes de crédito de WhatsApp vendidos no CRM (aba Automações > Comprar
// créditos). Preço por faixa definido pelo Bruno em 2026-10-21: quanto maior
// o pacote, menor o preço por mensagem. Só 2 tamanhos por faixa — sem
// interpolação, lista fechada.
const PACOTES_CREDITOS = Object.freeze([
  { chave: 'creditos_100', quantidade: 100, preco_unitario: 0.60 },
  { chave: 'creditos_250', quantidade: 250, preco_unitario: 0.60 },
  { chave: 'creditos_300', quantidade: 300, preco_unitario: 0.55 },
  { chave: 'creditos_500', quantidade: 500, preco_unitario: 0.55 },
  { chave: 'creditos_600', quantidade: 600, preco_unitario: 0.50 },
  { chave: 'creditos_1000', quantidade: 1000, preco_unitario: 0.50 },
  { chave: 'creditos_1200', quantidade: 1200, preco_unitario: 0.45 },
  { chave: 'creditos_1600', quantidade: 1600, preco_unitario: 0.45 },
  { chave: 'creditos_2000', quantidade: 2000, preco_unitario: 0.45 },
].map((p) => Object.freeze({ ...p, valor: Math.round(p.quantidade * p.preco_unitario * 100) / 100 })));

function listarPacotes() {
  return PACOTES_CREDITOS;
}

function obterPacote(chave) {
  return PACOTES_CREDITOS.find((p) => p.chave === chave) || null;
}

// Avisa o CRM (servidor-a-servidor, segredo compartilhado — mesmo padrão de
// PLATFORM_PAGAMENTOS_TOKEN na direção contrária) que um pagamento de
// créditos confirmou, pra ele somar ao saldo do tenant. O saldo em si mora no
// banco do CRM (consumido em lib/automacoes.js a cada disparo), não aqui.
async function confirmarCreditoNoCrm({ tenantId, quantidade, compraId }) {
  const url = process.env.CRM_CREDITOS_URL;
  const token = process.env.CRM_CREDITOS_INTERNAL_TOKEN;
  if (!url || !token) throw new Error('CRM_CREDITOS_URL/CRM_CREDITOS_INTERNAL_TOKEN não configurados');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
    body: JSON.stringify({ tenantId, quantidade, compraId }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`CRM respondeu ${res.status} ao confirmar créditos`);
  return res.json().catch(() => ({}));
}

// Chamado tanto pelo webhook da Asaas (Pix, assíncrono) quanto pelo caminho
// síncrono de cartão (comprar() já sabe na hora que confirmou). Claim atômico
// via UPDATE ... WHERE status = 'pendente': se duas chamadas chegarem quase
// juntas (ex. card confirma na hora E o webhook chega logo depois pro mesmo
// pagamento), só uma credita. Se a chamada ao CRM falhar, desfaz o claim —
// melhor reprocessar (próximo retry do webhook da Asaas, ou reconciliação
// manual) do que um tenant pagar e nunca receber o crédito.
async function confirmarCompraCreditos(pool, asaasPaymentId) {
  const { rows } = await pool.query(
    `UPDATE compras_creditos_crm SET status = 'confirmada', creditado_em = now()
     WHERE asaas_payment_id = $1 AND status = 'pendente'
     RETURNING id, tenant_id, quantidade_creditos`,
    [asaasPaymentId]
  );
  const compra = rows[0];
  if (!compra) return null;

  try {
    await confirmarCreditoNoCrm({ tenantId: compra.tenant_id, quantidade: compra.quantidade_creditos, compraId: compra.id });
  } catch (erro) {
    await pool.query(`UPDATE compras_creditos_crm SET status = 'pendente', creditado_em = null WHERE id = $1`, [compra.id]);
    throw erro;
  }
  return compra;
}

module.exports = { listarPacotes, obterPacote, confirmarCompraCreditos };
