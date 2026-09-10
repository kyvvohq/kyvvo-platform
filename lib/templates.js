// Utilitários de template de disparo (spec §9).

// Renderiza o corpo trocando {{1}}/{{2}}… (posicional, pela ordem) ou
// {{nome}} (nomeado) pelos exemplos. `variaveis` = [{ nome, exemplo }].
// Placeholder sem valor vira string vazia (não deixa "{{x}}" no preview).
function renderizar(corpo, variaveis = []) {
  const lista = Array.isArray(variaveis) ? variaveis : [];
  const porNome = new Map(lista.map((v) => [String(v.nome), v.exemplo ?? '']));
  return String(corpo || '').replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, chave) => {
    if (/^\d+$/.test(chave)) {
      const v = lista[Number(chave) - 1];
      return v ? String(v.exemplo ?? '') : '';
    }
    return porNome.has(chave) ? String(porNome.get(chave)) : '';
  });
}

// Placeholders usados no corpo, na ordem de aparição, sem repetir.
function extrairPlaceholders(corpo) {
  const achados = [];
  const re = /\{\{\s*([\w-]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(corpo || '')))) {
    if (!achados.includes(m[1])) achados.push(m[1]);
  }
  return achados;
}

module.exports = { renderizar, extrairPlaceholders };
