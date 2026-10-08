// Catálogo de planos do People pro fluxo de pagamentos — lê direto da tabela
// `planos` do platform (schema platform, mesma tabela que já serve
// GET /plans?produto=people, ver routes/entitlements.js), filtrado por
// produto='people'.
//
// Difere de kyvvo-people/lib/planos.js (que o People original usa e
// continua usando — fora de escopo mexer lá): aquele busca ao vivo em
// studio.kyvvo.com.br/api/planos/people (resquício de antes do platform
// existir). Aqui, rodando dentro do próprio platform, é mais simples e mais
// robusto ler a tabela local em vez de fazer uma chamada HTTP de volta pro
// Studio — mesmo dado, sem a dependência externa.
async function buscarPlanos(pool) {
  const { rows } = await pool.query(
    `SELECT chave, nome, descricao, preco_mensal, destaque, badge
       FROM planos WHERE produto = 'people' AND ativo = true
       ORDER BY preco_mensal`
  );
  return rows.map((r) => ({ ...r, preco_mensal: Number(r.preco_mensal) }));
}

async function buscarPlano(pool, chave) {
  const planosList = await buscarPlanos(pool);
  return planosList.find((p) => p.chave === chave) || null;
}

module.exports = { buscarPlanos, buscarPlano };
