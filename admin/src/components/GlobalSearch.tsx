import { useState } from 'react';

// Stub da busca global (spec §14). A federação real —
// GET /admin/api/search?q= sobre empresas/usuários/telefones/PNID — entra
// na Fase 1. Por ora só o campo, pra fixar o lugar no topbar.
export function GlobalSearch() {
  const [q, setQ] = useState('');
  return (
    <form
      className="busca-global"
      onSubmit={(e) => {
        e.preventDefault();
        // TODO(fase 1): navegar pra /busca?q= e federar resultados
      }}
    >
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar empresa, usuário, telefone, WABA…"
        aria-label="Busca global"
      />
    </form>
  );
}
