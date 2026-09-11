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

// Consumo de IA agregado — vem do adapter do Studio (conversas_ia mora lá).
// null = adapter fora / sem token.
async function buscarIaUso(dias = 30) {
  if (!TOKEN) return null;
  const studio = ADAPTERS.find((a) => a.produto === 'studio');
  if (!studio) return null;
  try {
    const res = await fetch(`${studio.baseUrl}/admin-adapter/ia-uso?dias=${dias}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Proxy genérico pro adapter do Studio (números prontos etc.) — devolve
// { status, body } pra rota do platform repassar tal e qual, depois de
// aplicar o RBAC e gravar a auditoria.
async function chamarAdapterStudio(metodo, caminho, body) {
  const studio = ADAPTERS.find((a) => a.produto === 'studio');
  if (!TOKEN || !studio) {
    return { status: 503, body: { error: 'Adapter do Studio não configurado.' } };
  }
  try {
    const res = await fetch(`${studio.baseUrl}/admin-adapter${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const corpo = await res.json().catch(() => null);
    return { status: res.status, body: corpo };
  } catch (err) {
    return {
      status: 502,
      body: { error: err && err.name === 'TimeoutError' ? 'timeout no adapter' : 'adapter indisponível' },
    };
  }
}

module.exports = { buscarPaineisProduto, buscarIaUso, chamarAdapterStudio };
