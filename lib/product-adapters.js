// Fan-out pros adapters de produto (spec §16). Cada produto expõe
// GET /admin-adapter/tenants/:id na rede interna do compose; a Admin API
// agrega esses painéis na visão 360°.
//
// Falha de um adapter (fora do ar, timeout, sem token) NÃO derruba a 360° —
// vira um item `{ produto, _erro }` que o front mostra como "indisponível".
// Sem ADMIN_ADAPTER_TOKEN no ambiente, o fan-out fica inteiro desligado
// (retorna []): é o estado até o Bruno provisionar o segredo no SSM.

const TOKEN = process.env.ADMIN_ADAPTER_TOKEN;

// Hoje só o Studio. O People tem banco/tenants próprios (não são linhas de
// platform.tenants), então não entra aqui. Leads/CRM quando existirem —
// basta uma linha nesta lista.
const ADAPTERS = [
  { produto: 'studio', baseUrl: process.env.STUDIO_ADAPTER_URL || 'http://studio:3001' },
];

async function buscarPainel(adapter, tenantId) {
  try {
    const res = await fetch(`${adapter.baseUrl}/admin-adapter/tenants/${tenantId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null; // tenant não existe nesse produto
    if (!res.ok) return { produto: adapter.produto, _erro: `adapter respondeu ${res.status}` };
    return await res.json();
  } catch (err) {
    return {
      produto: adapter.produto,
      _erro: err && err.name === 'TimeoutError' ? 'timeout' : 'indisponível',
    };
  }
}

async function buscarPaineisProduto(tenantId) {
  if (!TOKEN) return [];
  const resultados = await Promise.all(ADAPTERS.map((a) => buscarPainel(a, tenantId)));
  return resultados.filter((r) => r !== null);
}

module.exports = { buscarPaineisProduto };
