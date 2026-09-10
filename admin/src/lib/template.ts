// Espelho client-side de lib/templates.js (renderizar) — pro preview no
// editor antes de salvar. Manter em sincronia com o backend.

export interface Variavel {
  nome: string;
  exemplo: string;
}

export function renderizar(corpo: string, variaveis: Variavel[]): string {
  const porNome = new Map(variaveis.map((v) => [v.nome, v.exemplo ?? '']));
  return (corpo || '').replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, chave: string) => {
    if (/^\d+$/.test(chave)) {
      const v = variaveis[Number(chave) - 1];
      return v ? String(v.exemplo ?? '') : '';
    }
    return porNome.has(chave) ? String(porNome.get(chave)) : '';
  });
}
